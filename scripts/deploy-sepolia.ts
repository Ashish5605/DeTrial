import { ethers } from "hardhat";

async function main() {
  console.log("Starting Sepolia deployment...");
  
  if (!process.env.PRIVATE_KEY) {
    throw new Error("Missing PRIVATE_KEY in environment variables.");
  }

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account: ${deployer.address}`);
  
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

  // 1. KeyRegistry
  console.log("Deploying KeyRegistry...");
  const KeyRegistry = await ethers.getContractFactory("KeyRegistry");
  const keyRegistry = await KeyRegistry.deploy(deployer.address);
  await keyRegistry.waitForDeployment();
  const keyRegistryAddress = await keyRegistry.getAddress();
  console.log(`KeyRegistry deployed to: ${keyRegistryAddress}`);

  // 2. CheckpointAnchor
  console.log("Deploying CheckpointAnchor...");
  const CheckpointAnchor = await ethers.getContractFactory("CheckpointAnchor");
  const witnessAddress = process.env.WITNESS_ADDRESS || deployer.address;
  const checkpointAnchor = await CheckpointAnchor.deploy(deployer.address, [witnessAddress], 1);
  await checkpointAnchor.waitForDeployment();
  const checkpointAnchorAddress = await checkpointAnchor.getAddress();
  console.log(`CheckpointAnchor deployed to: ${checkpointAnchorAddress}`);

  // 3. DisputeManager
  console.log("Deploying DisputeManager...");
  const DisputeManager = await ethers.getContractFactory("DisputeManager");
  const disputeManager = await DisputeManager.deploy(keyRegistryAddress, checkpointAnchorAddress);
  await disputeManager.waitForDeployment();
  const disputeManagerAddress = await disputeManager.getAddress();
  console.log(`DisputeManager deployed to: ${disputeManagerAddress}`);

  console.log("==========================================");
  console.log("Deployment Complete! Set these in Render:");
  console.log(`KEY_REGISTRY_ADDRESS=${keyRegistryAddress}`);
  console.log(`CHECKPOINT_ANCHOR_ADDRESS=${checkpointAnchorAddress}`);
  console.log(`DISPUTE_MANAGER_ADDRESS=${disputeManagerAddress}`);
  console.log(`DEPARTMENT_PRIVATE_KEY=<your_private_key>`);
  console.log(`CHAIN_ID=11155111`);
  console.log("==========================================");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
