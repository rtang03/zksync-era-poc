import { Deployer } from '@matterlabs/hardhat-zksync-deploy';
import dotenv from 'dotenv';
import * as ethers from 'ethers';
import type { HardhatRuntimeEnvironment } from 'hardhat/types';
import { Provider, utils, Wallet } from 'zksync-web3';

dotenv.config();
const PK = process.env.PRIVATE_KEY;

const deployFcn = async (hre: HardhatRuntimeEnvironment) => {
  if (!PK) throw new Error('No private key');
  const wallet = new Wallet(PK, new Provider('http://localhost:3050'));
  const deployer = new Deployer(hre, wallet);
  const factoryArtifact = await deployer.loadArtifact('AAFactory');
  const aaArtifact = await deployer.loadArtifact('DefaultAccount');

  // Getting the bytecodeHash of the account
  const bytecodeHash = utils.hashBytecode(aaArtifact.bytecode);

  const factory = await deployer.deploy(factoryArtifact, [bytecodeHash], { gasLimit: 50_000_000 }, [
    // Since the factory requires the code of the DefaultAccount to be available,
    // we should pass it here as well.
    aaArtifact.bytecode
  ]);

  console.log(`AA factory address: ${factory.address}`);
  const aaFactory = new ethers.Contract(factory.address, factoryArtifact.abi, wallet);
  const owner = Wallet.createRandom();
  console.log('owner pk: ', owner.privateKey);
  const salt = ethers.constants.HashZero;
  const tx = await aaFactory.deployAccount(salt, owner.address);
  await tx.wait();

  const abiCoder = new ethers.utils.AbiCoder();
  const accountAddress = utils.create2Address(
    factory.address,
    await aaFactory.aaBytecodeHash(),
    salt,
    abiCoder.encode(['address'], [owner.address])
  );

  console.log(`Account deployed on address ${accountAddress}`);
  const txResponse = await wallet.sendTransaction({
    to: accountAddress,
    value: ethers.utils.parseEther('0.01')
  });
  console.log('hash: ', txResponse.hash);
  await txResponse.wait();
};

export default deployFcn;
