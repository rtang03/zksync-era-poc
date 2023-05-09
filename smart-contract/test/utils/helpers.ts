import { Contract, Provider, Wallet } from 'zksync-web3';

export const getBalances = async (
  provider: Provider,
  deployerWallet: Wallet,
  account: Contract,
  clientWallet: Wallet
) => {
  return {
    deployerWalletBalance: await provider.getBalance(deployerWallet.address),
    contractAccountBalance: await provider.getBalance(account.address),
    clientWalletBalance: await provider.getBalance(clientWallet.address)
  };
};
