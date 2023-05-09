import { utils as ethersUtils } from 'ethers';
import { Contract, EIP712Signer, Provider, types, utils, Wallet } from 'zksync-web3';

export const sendTransaction = async (
  provider: Provider,
  account: Contract,
  ownerWallet: Wallet,
  tx: types.TransactionRequest
) => {
  const _tx: types.TransactionRequest = {
    ...tx,
    from: account.address,
    chainId: (await provider.getNetwork()).chainId,
    nonce: await provider.getTransactionCount(account.address),
    type: 113,
    customData: {
      gasPerPubdata: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT
    } as types.Eip712Meta
  };
  _tx.gasPrice = await provider.getGasPrice();
  _tx.gasLimit ||= await provider.estimateGas(_tx);

  const signedTxHash = EIP712Signer.getSignedDigest(_tx);
  _tx.customData = {
    ..._tx.customData,
    customSignature: ethersUtils.arrayify(
      ethersUtils.joinSignature(ownerWallet._signingKey().signDigest(signedTxHash))
    )
  };

  return provider.sendTransaction(utils.serialize(_tx));
};
