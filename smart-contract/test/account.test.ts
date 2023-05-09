import { expect } from 'chai';
import { BigNumber, utils as ethersUtils } from 'ethers';
import { Contract, Provider, utils, Wallet } from 'zksync-web3';

import { deployAAFactory, deployAccount } from '../utils/deploy';
import { sendTransaction } from '../utils/sendTransaction';
import { getBalances } from './utils/helpers';
import { rich_wallet } from './utils/rich-wallets';

const dev_pk = rich_wallet[0].privateKey;

let provider: Provider;
let deployerWallet: Wallet;
let ownerWallet: Wallet;
let factory: Contract;
let contractAccount1: Contract;
let contractAccount2: Contract;
let contractAccount1_1: Contract;

const SOME_ETHERS = ethersUtils.parseEther('0.05');
const loadFixture = async () => {
  provider = Provider.getDefaultProvider();
  deployerWallet = new Wallet(dev_pk, provider);
  ownerWallet = Wallet.createRandom();
  console.log('Deployer wallet: ', deployerWallet.address);
  factory = await deployAAFactory(deployerWallet);
  console.log(`AA factory address: ${factory.address}`);
  contractAccount1 = await deployAccount(deployerWallet, ownerWallet, factory.address, '1');
  console.log('ContractAccount1 deployed: ', contractAccount1.address);
  return { ownerWallet, deployerWallet, provider, contractAccount1, factory };
};

describe('zksync tests', () => {
  describe('Deploy Default Account', () => {
    before(async () => {
      ({ ownerWallet, contractAccount1, provider, factory } = await loadFixture());
    });

    it('should deploy DefaultAccount with right owner', async () => {
      expect(await provider.getBalance(contractAccount1.address)).to.equal(0);
      expect(await contractAccount1.owner()).to.equal(ownerWallet.address);
    });

    it('should send eth from Deployer to new account', async () => {
      const amount = ethersUtils.parseEther('0.1');
      await expect(() =>
        deployerWallet.transfer({
          to: contractAccount1.address,
          token: utils.ETH_ADDRESS,
          amount
        })
      ).to.changeEtherBalance(deployerWallet.address, amount.mul(-1));
      const { contractAccountBalance } = await getBalances(
        provider,
        deployerWallet,
        contractAccount1,
        ownerWallet
      );
      // 100_000_000_000_000_000 or 0.1 eth
      expect(contractAccountBalance).to.equal(BigNumber.from('0x016345785d8a0000'));
    });

    it('should fail to deploy account with same salt', async () =>
      expect(
        factory.deployAccount(ethersUtils.keccak256(Buffer.from('1')), ownerWallet.address)
      ).to.revertedWith('nt faile'));

    it('should deploy contractAccount2', async () => {
      contractAccount2 = await deployAccount(deployerWallet, ownerWallet, factory.address, '2');
      expect(await provider.getBalance(contractAccount2.address)).to.equal(0);
    });

    it('should fail tranfer eth: insufficent balance in account1', async () => {
      const TOO_MUCH_ETHERS = ethersUtils.parseEther('0.1');
      await expect(
        sendTransaction(provider, contractAccount1, ownerWallet, {
          to: contractAccount2.address,
          value: TOO_MUCH_ETHERS,
          data: '0x'
        })
      ).to.reverted;
      // should revertedWithReason
      // 'value. balance: 100000000000000000, fee: 43172500000000, value: 10000000000000000'
    });

    it('should transfer eth from account1 to account2', async () => {
      await expect(
        sendTransaction(provider, contractAccount1, ownerWallet, {
          to: contractAccount2.address,
          value: SOME_ETHERS,
          data: '0x'
        })
      ).to.changeEtherBalances(
        [contractAccount1.address, contractAccount2.address],
        [SOME_ETHERS.mul(-1), SOME_ETHERS]
      );
    });

    it('should get correct balance', async () => {
      expect(await provider.getBalance(contractAccount1.address)).to.closeTo(
        SOME_ETHERS, // 0.1 - 0.05 - gas
        ethersUtils.parseEther('0.01') // delta ~ gas
      );
      expect(await provider.getBalance(contractAccount2.address)).to.equal(SOME_ETHERS);
    });
  });
});
