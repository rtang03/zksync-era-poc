// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@matterlabs/zksync-contracts/l2/system-contracts/interfaces/IAccount.sol';
import '@matterlabs/zksync-contracts/l2/system-contracts/libraries/TransactionHelper.sol';
import '@openzeppelin/contracts/interfaces/IERC1271.sol';
// Access zkSync system contracts, in this case for nonce validation vs NONCE_HOLDER_SYSTEM_CONTRACT
import '@matterlabs/zksync-contracts/l2/system-contracts/Constants.sol';
// to call non-view method of system contracts
import '@matterlabs/zksync-contracts/l2/system-contracts/libraries/SystemContractsCaller.sol';
import {SignatureChecker} from '@matterlabs/signature-checker/contracts/SignatureChecker.sol';

// see https://github.com/matter-labs/v2-testnet-contracts/blob/main/l2/system-contracts/DefaultAccount.sol#L17

contract DefaultAccount is IAccount, IERC1271 {
  using TransactionHelper for Transaction;
  using SignatureChecker for address;

  address public owner;

  // bytes4(keccak256("isValidSignature(bytes32,bytes)")
  bytes4 constant EIP1271_SUCCESS_RETURN_VALUE = 0x1626ba7e;

  /**
   * @dev Simulate the behavior of the EOA if the caller is not the bootloader.
   * Essentially, for all non-bootloader callers halt the execution with empty return data.
   * If all functions will use this modifier AND the contract will implement an empty payable fallback()
   * then the contract will be indistinguishable from the EOA when called.
   */
  modifier onlyBootloader() {
    require(msg.sender == BOOTLOADER_FORMAL_ADDRESS, 'Only bootloader can call this method');
    // Continure execution if called from the bootloader.
    _;
  }

  /**
   * @dev Simulate the behavior of the EOA if it is called via `delegatecall`.
   * Thus, the default account on a delegate call behaves the same as EOA on Ethereum.
   * If all functions will use this modifier AND the contract will implement an empty payable fallback()
   * then the contract will be indistinguishable from the EOA when called.
   */
  modifier ignoreInDelegateCall() {
    address codeAddress = SystemContractHelper.getCodeAddress();
    if (codeAddress != address(this)) {
      assembly {
        return(0, 0)
      }
    }
    _;
  }

  constructor(address _owner) {
    owner = _owner;
  }

  /// @notice Validates the transaction & increments nonce.
  /// @dev The transaction is considered accepted by the account if
  /// the call to this function by the bootloader does not revert
  /// and the nonce has been set as used.
  /// @param _suggestedSignedHash The suggested hash of the transaction to be signed by the user.
  /// This is the hash that is signed by the EOA by default.
  /// @param _transaction The transaction structure itself.
  /// @dev Besides the params above, it also accepts unused first paramter "_txHash", which
  /// is the unique (canonical) hash of the transaction.
  function validateTransaction(
    bytes32, // _txHash
    bytes32 _suggestedSignedHash,
    Transaction calldata _transaction
  ) external payable override onlyBootloader ignoreInDelegateCall returns (bytes4 magic) {
    magic = _validateTransaction(_suggestedSignedHash, _transaction);
  }

  /// @notice Inner method for validating transaction and increasing the nonce
  /// @param _suggestedSignedHash The hash of the transaction signed by the EOA
  /// @param _transaction The transaction.
  function _validateTransaction(
    bytes32 _suggestedSignedHash,
    Transaction calldata _transaction
  ) internal returns (bytes4 magic) {
    // Incrementing the nonce of the account.
    // Note, that reserved[0] by convention is currently equal to the nonce passed in the transaction
    SystemContractsCaller.systemCallWithPropagatedRevert(
      uint32(gasleft()),
      address(NONCE_HOLDER_SYSTEM_CONTRACT),
      0,
      abi.encodeCall(INonceHolder.incrementMinNonceIfEquals, (_transaction.nonce))
    );

    // Even though for the transaction types present in the system right now,
    // we always provide the suggested signed hash, this should not be
    // always expected. In case the bootloader has no clue what the default hash
    // is, the bytes32(0) will be supplied.
    bytes32 txHash = _suggestedSignedHash == bytes32(0)
      ? _transaction.encodeHash()
      : _suggestedSignedHash;

    // The fact there is are enough balance for the account
    // should be checked explicitly to prevent user paying for fee for a
    // transaction that wouldn't be included on Ethereum.
    uint256 totalRequiredBalance = _transaction.totalRequiredBalance();
    require(totalRequiredBalance <= address(this).balance, 'Not enough balance for fee + value');

    if (isValidSignature(txHash, _transaction.signature) == EIP1271_SUCCESS_RETURN_VALUE) {
      magic = ACCOUNT_VALIDATION_SUCCESS_MAGIC;
    } else {
      magic = bytes4(0);
    }
  }

  /// @notice Method called by the bootloader to execute the transaction.
  /// @param _transaction The transaction to execute.
  /// @dev It also accepts unused _txHash and _suggestedSignedHash parameters:
  /// the unique (canonical) hash of the transaction and the suggested signed
  /// hash of the transaction.
  function executeTransaction(
    bytes32, // _txHash
    bytes32, // _suggestedSignedHash
    Transaction calldata _transaction
  ) external payable override onlyBootloader ignoreInDelegateCall {
    _execute(_transaction);
  }

  /// @notice Method that should be used to initiate a transaction from this account by an external call.
  /// @dev The custom account is supposed to implement this method to initiate a transaction on behalf
  /// of the account via L1 -> L2 communication. However, the default account can initiate a transaction
  /// from L1, so we formally implement the interface method, but it doesn't execute any logic.
  /// @param _transaction The transaction to execute.
  function executeTransactionFromOutside(
    Transaction calldata _transaction
  ) external payable override {
    _validateTransaction(bytes32(0), _transaction);
    _execute(_transaction);
  }

  /// @notice Inner method for executing a transaction.
  /// @param _transaction The transaction to execute.
  function _execute(Transaction calldata _transaction) internal {
    address to = address(uint160(_transaction.to));
    uint128 value = Utils.safeCastToU128(_transaction.value);
    bytes memory data = _transaction.data;

    if (to == address(DEPLOYER_SYSTEM_CONTRACT)) {
      uint32 gas = Utils.safeCastToU32(gasleft());

      // Note, that the deployer contract can only be called
      // with a "systemCall" flag.
      SystemContractsCaller.systemCallWithPropagatedRevert(gas, to, value, data);
    } else {
      bool success;
      assembly {
        success := call(gas(), to, value, add(data, 0x20), mload(data), 0, 0)
      }
      require(success);
    }
  }

  /// @notice Validation that the ECDSA signature of the transaction is correct.
  /// @param _hash The hash of the transaction to be signed.
  /// @param _signature The signature of the transaction.
  /// @return magic EIP1271_SUCCESS_RETURN_VALUE if the signaure is correct. It reverts otherwise.
  function isValidSignature(
    bytes32 _hash,
    bytes memory _signature
  ) public view override returns (bytes4 magic) {
    if (owner.isValidSignatureNow(_hash, _signature)) {
      magic = EIP1271_SUCCESS_RETURN_VALUE;
    } else {
      magic = bytes4(0);
    }
  }

  /// @notice Method for paying the bootloader for the transaction.
  /// @param _transaction The transaction for which the fee is paid.
  /// @dev It also accepts unused _txHash and _suggestedSignedHash parameters:
  /// the unique (canonical) hash of the transaction and the suggested signed
  /// hash of the transaction.
  function payForTransaction(
    bytes32, // _txHash
    bytes32, // _suggestedSignedHash
    Transaction calldata _transaction
  ) external payable onlyBootloader ignoreInDelegateCall {
    bool success = _transaction.payToTheBootloader();
    require(success, 'Failed to pay the fee to the operator');
  }

  /// @notice Method, where the user should prepare for the transaction to be
  /// paid for by a paymaster.
  /// @dev Here, the account should set the allowance for the smart contracts
  /// @param _transaction The transaction.
  /// @dev It also accepts unused _txHash and _suggestedSignedHash parameters:
  /// the unique (canonical) hash of the transaction and the suggested signed
  /// hash of the transaction.
  function prepareForPaymaster(
    bytes32, // _txHash
    bytes32, // _suggestedSignedHash
    Transaction calldata _transaction
  ) external payable onlyBootloader ignoreInDelegateCall {
    _transaction.processPaymasterInput();
  }

  fallback() external payable {
    // fallback of default account shouldn't be called by bootloader under no circumstances
    assert(msg.sender != BOOTLOADER_FORMAL_ADDRESS);

    // If the contract is called directly, behave like an EOA
  }

  receive() external payable {
    // If the contract is called directly, behave like an EOA
  }
}
