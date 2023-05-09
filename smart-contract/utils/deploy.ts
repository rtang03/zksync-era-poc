import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import { ethers, utils as ethersUtils } from 'ethers';
import * as hre from 'hardhat';
import { utils, Wallet } from 'zksync-web3';

export const deployAAFactory = async (wallet: Wallet) => {
  let deployer: Deployer = new Deployer(hre, wallet);
  const factoryArtifact = await deployer.loadArtifact('AAFactory');
  const accountArtifact = await deployer.loadArtifact('DefaultAccount');
  const bytecodeHash = utils.hashBytecode(accountArtifact.bytecode);

  return await deployer.deploy(factoryArtifact, [bytecodeHash], undefined, [
    accountArtifact.bytecode
  ]);
};

export const calcContractAccountAddress = async (
  factory: ethers.Contract,
  salt: string,
  ownerAddress: string
) => {
  const AbiCoder = new ethersUtils.AbiCoder();

  return utils.create2Address(
    factory.address,
    await factory.aaBytecodeHash(),
    salt,
    AbiCoder.encode(['address'], [ownerAddress])
  );
};

export const deployAccount = async (
  deployerWallet: Wallet,
  ownerWallet: Wallet,
  factoryAddress: string,
  saltString: string
) => {
  let deployer: Deployer = new Deployer(hre, deployerWallet);
  const factoryArtifact = await hre.artifacts.readArtifact('AAFactory');
  const factory = new ethers.Contract(factoryAddress, factoryArtifact.abi, deployerWallet);
  const salt = ethersUtils.keccak256(Buffer.from(saltString));
  const tx = await factory.deployAccount(salt, ownerWallet.address);

  await tx.wait();

  const accountAddress = await calcContractAccountAddress(factory, salt, ownerWallet.address);

  const accountArtifact = await deployer.loadArtifact('DefaultAccount');

  return new ethers.Contract(accountAddress, accountArtifact.abi, deployerWallet);
};
