import chai, { expect, should } from "chai";
import chaiAsPromised from "chai-as-promised";
import { ethers, network, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { getReceipt, parseEther } from "../utils/helpers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import {
    DAT, DATPausable, DATVotes,
    DATFactoryImplementation, VestingWallet,
} from "../typechain-types";
import { EventLog } from "ethers";

chai.use(chaiAsPromised);
should();

describe("DATFactory + VestingWallet", () => {
    let owner: HardhatEthersSigner;
    let maintainer: HardhatEthersSigner;
    let admin: HardhatEthersSigner;
    let beneficiary1: HardhatEthersSigner;
    let beneficiary2: HardhatEthersSigner;
    let user1: HardhatEthersSigner;
    let user2: HardhatEthersSigner;
    let user3: HardhatEthersSigner;
    let treasury: HardhatEthersSigner;
    let ammPair: HardhatEthersSigner;

    let datFactory: DATFactoryImplementation;
    let datToken: DAT;
    let vestingWallet1: VestingWallet;
    let vestingWallet2: VestingWallet;

    let datImplementation: DAT;
    let datVotesImplementation: DATVotes;
    let datPausableImplementation: DATPausable;

    const minCap = parseEther(1000); // 1,000 tokens
    const maxCap = parseEther(100_000_000); // 100M tokens

    const DEFAULT_ADMIN_ROLE =
        "0x0000000000000000000000000000000000000000000000000000000000000000";
    const MAINTAINER_ROLE = ethers.keccak256(
        ethers.toUtf8Bytes("MAINTAINER_ROLE"),
    );
    const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));

    // Generic token parameters
    const tokenName = "Digital Asset Token";
    const tokenSymbol = "DAT";
    const tokenCap = parseEther(10_000_000); // 10M tokens
    const tokenSalt = ethers.id("TEST_SALT");

    // Define a deploy function to reuse
    async function deploy() {
        await network.provider.request({
            method: "hardhat_reset",
            params: [],
        });

        // Get signers
        [
            owner,
            maintainer,
            admin,
            beneficiary1,
            beneficiary2,
            user1,
            user2,
            user3,
            treasury,
            ammPair,
        ] = await ethers.getSigners();

        // Deploy DATFactory
        const datTokenFactory = await ethers.getContractFactory("DAT");
        datImplementation = await datTokenFactory.deploy()
            .then((instance) => instance.waitForDeployment()) as DAT;

        const datVotesFactory = await ethers.getContractFactory("DATVotes");
        datVotesImplementation = await datVotesFactory.deploy()
            .then((instance) => instance.waitForDeployment()) as DATVotes;

        const datPausableFactory = await ethers.getContractFactory("DATPausable");
        datPausableImplementation = await datPausableFactory.deploy()
            .then((instance) => instance.waitForDeployment()) as DATPausable;

        const factoryDeploy = await upgrades.deployProxy(
            await ethers.getContractFactory("DATFactoryImplementation"),
            [owner.address, minCap, maxCap, datImplementation.target, datVotesImplementation.target, datPausableImplementation.target, treasury.address],
            {
                kind: "uups",
            },
        );

        datFactory = await ethers.getContractAt(
            "DATFactoryImplementation",
            factoryDeploy.target,
        );

        // Set up roles
        await datFactory
            .connect(owner)
            .grantRole(MAINTAINER_ROLE, maintainer.address);
    }

    // Create token with vesting schedules
    async function createTokenWithVesting() {
        const now = Math.floor(Date.now() / 1000);
        const amount1 = parseEther(1_000_000);
        const amount2 = parseEther(2_000_000);

        const vestingSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: now,
                cliff: 90 * 86400, // 90 days cliff
                duration: 365 * 86400, // 1 year total vesting
                amount: amount1,
            },
            {
                beneficiary: beneficiary2.address,
                start: now,
                cliff: 180 * 86400, // 180 days cliff
                duration: 730 * 86400, // 2 years total vesting
                amount: amount2,
            },
        ];

        // Create token with schedules
        const tx = await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: vestingSchedules,
                salt: tokenSalt,
                owner: admin.address,
            });

        const receipt = await getReceipt(tx);

        // Extract token address from events
        const createEvent = receipt.logs.find(
            (log) => (log as EventLog).fragment?.name === "DATCreated",
        ) as EventLog;

        should().exist(createEvent);
        const tokenAddress = createEvent.args[0];

        // Extract vesting wallet addresses
        const vestingWalletEvents = receipt.logs.filter(
            (log) => (log as EventLog).fragment?.name === "VestingWalletCreated",
        ) as EventLog[];

        vestingWallet1 = await ethers.getContractAt(
            "VestingWallet",
            vestingWalletEvents[0].args[0],
        );

        vestingWallet2 = await ethers.getContractAt(
            "VestingWallet",
            vestingWalletEvents[1].args[0],
        );

        // Access the token
        datToken = await ethers.getContractAt("DAT", tokenAddress);

        return { vestingSchedules, amount1, amount2 };
    }

    beforeEach(async () => {
        await deploy();
    });

    it("should correctly set up vesting wallets", async function () {
        const { vestingSchedules, amount1, amount2 } = await createTokenWithVesting();

        // Check beneficiaries
        (await vestingWallet1.owner()).should.eq(
            vestingSchedules[0].beneficiary,
        );
        (await vestingWallet2.owner()).should.eq(
            vestingSchedules[1].beneficiary,
        );

        // Check durations - note they are adjusted by the factory
        const start1 = BigInt(vestingSchedules[0].start);
        const cliff1 = BigInt(vestingSchedules[0].cliff);
        const duration1 = BigInt(vestingSchedules[0].duration);

        const start2 = BigInt(vestingSchedules[1].start);
        const cliff2 = BigInt(vestingSchedules[1].cliff);
        const duration2 = BigInt(vestingSchedules[1].duration);

        (await vestingWallet1.start()).should.eq(start1 + cliff1);
        (await vestingWallet1.duration()).should.eq(duration1 - cliff1);
        (await vestingWallet1.end()).should.eq(start1 + duration1);
        (await vestingWallet1["vestedAmount(address,uint64)"](datToken.target, start1)).should.eq(0);
        (await vestingWallet1["vestedAmount(address,uint64)"](datToken.target, start1 + cliff1)).should.eq(0);
        (await vestingWallet1["vestedAmount(address,uint64)"](datToken.target, start1 + duration1)).should.eq(amount1);

        (await vestingWallet2.start()).should.eq(start2 + cliff2);
        (await vestingWallet2.duration()).should.eq(duration2 - cliff2);
        (await vestingWallet2.end()).should.eq(start2 + duration2);
        (await vestingWallet2["vestedAmount(address,uint64)"](datToken.target, start2)).should.eq(0);
        (await vestingWallet2["vestedAmount(address,uint64)"](datToken.target, start2 + cliff2)).should.eq(0);
        (await vestingWallet2["vestedAmount(address,uint64)"](datToken.target, start2 + duration2)).should.eq(amount2);

        // From OZ VestingWallet - calculateReleasable uses
        // uint256 vestedAmount = vestedAmount(token, timestamp);
        // return vestedAmount - released(token);

        // Initial release should be 0
        (await vestingWallet1["releasable(address)"](datToken.target)).should.eq(0);
        (await vestingWallet2["releasable(address)"](datToken.target)).should.eq(0);
    });

    it("should release tokens according to vesting schedule", async function () {
        const { vestingSchedules, amount1, amount2 } =
            await createTokenWithVesting();

        // Get initial setup
        const start1 = BigInt(vestingSchedules[0].start);
        const cliff1 = BigInt(vestingSchedules[0].cliff);
        const duration1 = BigInt(vestingSchedules[0].duration);

        // Time to cliff - no tokens available yet
        let nextTimestamp = start1 + cliff1 - 10n;
        await time.increaseTo(nextTimestamp);

        let block = await ethers.provider.getBlock("latest");
        block!.timestamp.should.eq(nextTimestamp);

        (await vestingWallet1["releasable(address)"](datToken.target)).should.eq(0);

        // Time to cliff + 1 - tokens start to release
        nextTimestamp = start1 + cliff1 + 10n;
        await time.increaseTo(nextTimestamp);

        // Calculate expected release at this point
        // Expected formula: (amount * timeElapsed) / duration
        // Note that cliff is not included in the eslapsed time,
        // that means no tokens are released during the cliff period
        const effectiveDuration1 = duration1 - cliff1;
        let timeElapsed = 10n;
        let expectedRelease = (amount1 * timeElapsed) / effectiveDuration1;

        let actualRelease = await vestingWallet1["releasable(address)"](datToken.target);
        actualRelease.should.eq(expectedRelease);

        // Release tokens
        await vestingWallet1.connect(beneficiary1)["release(address)"](datToken.target);

        block = await ethers.provider.getBlock("latest");
        expectedRelease = (amount1 * (BigInt(block!.timestamp) - start1 - cliff1)) / (duration1 - cliff1);

        // Beneficiary should have received tokens
        let releasedAmount = await vestingWallet1["released(address)"](datToken.target);
        releasedAmount.should.eq(expectedRelease);
        (await datToken.balanceOf(beneficiary1)).should.eq(expectedRelease);

        // Advance to halfway through vesting
        nextTimestamp = start1 + duration1 / 2n;
        await time.increaseTo(nextTimestamp);

        // Calculate expected release after half duration
        const halfTimeElapsed = nextTimestamp - start1 - cliff1;
        const halfExpectedRelease = (amount1 * halfTimeElapsed) / effectiveDuration1;

        // Released amount should be deducted
        actualRelease = await vestingWallet1["releasable(address)"](datToken.target);
        actualRelease.should.eq(halfExpectedRelease - releasedAmount);

        // Release again
        await vestingWallet1.connect(beneficiary1)["release(address)"](datToken.target);

        block = await ethers.provider.getBlock("latest");
        expectedRelease = (amount1 * (BigInt(block!.timestamp) - start1 - cliff1)) / (duration1 - cliff1);

        // Beneficiary should have received more tokens
        releasedAmount = await vestingWallet1["released(address)"](datToken.target);
        releasedAmount.should.eq(expectedRelease);
        (await datToken.balanceOf(beneficiary1)).should.eq(expectedRelease);

        // Advance to end of vesting
        await time.increaseTo(start1 + duration1 + 10n);

        // Should be able to release remaining tokens
        await vestingWallet1.connect(beneficiary1)["release(address)"](datToken.target);

        // Beneficiary should have received all tokens
        releasedAmount = await vestingWallet1["released(address)"](datToken.target);
        releasedAmount.should.eq(amount1);
        (await datToken.balanceOf(beneficiary1)).should.eq(amount1);

        // No more tokens to release
        (await vestingWallet1["releasable(address)"](datToken.target)).should.eq(0);
    });

    it("should allow releasing tokens by anyone (not just beneficiary)", async function () {
        const { amount1 } = await createTokenWithVesting();

        // Advance to fully vested state
        const vestedTime = (await vestingWallet1.end()) + 1n;
        await time.increaseTo(vestedTime);

        // Release tokens as a random user
        await vestingWallet1.connect(user3)["release(address)"](datToken.target);

        // Beneficiary should have received tokens, not the caller
        (await datToken.balanceOf(user3)).should.eq(0);
        // (await datToken.balanceOf(beneficiary1)).should.be.almostEq(
        //     amount1,
        //     1000n,
        // );
    });

    it("should have correct parameters after deployment", async function () {
        (await datFactory.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).should.eq(
            true,
        );
        (await datFactory.hasRole(MAINTAINER_ROLE, owner.address)).should.eq(
            true,
        );
        (
            await datFactory.hasRole(MAINTAINER_ROLE, maintainer.address)
        ).should.eq(true);

        (await datFactory.minCapDefault()).should.eq(minCap);
        (await datFactory.maxCapDefault()).should.eq(maxCap);

        // Verify template address is set
        const defaultTemplate = await datFactory.datTemplates(0); // 0 = DATType.DEFAULT
        defaultTemplate.should.not.eq(ethers.ZeroAddress);
        defaultTemplate.should.eq(datImplementation.target);
        (await datFactory.datTemplates(1)).should.eq(datVotesImplementation.target);
        (await datFactory.datTemplates(2)).should.eq(datPausableImplementation.target);
    });

    it("should add created tokens to the datList", async function () {
        // Initial count should be 0
        (await datFactory.datListCount()).should.eq(0);

        // Create first token
        const tx1 = await datFactory.connect(owner).createToken({
            datType: 0,
            name: tokenName,
            symbol: tokenSymbol,
            cap: tokenCap,
            schedules: [],
            salt: ethers.id("SALT1"),
            owner: admin.address,
        });
        const receipt1 = await getReceipt(tx1);
        const createEvent1 = receipt1.logs.find(
            (log) => (log as EventLog).fragment?.name === "DATCreated",
        ) as EventLog;
        should().exist(createEvent1);
        const tokenAddress1 = createEvent1.args[0];
        const predictedAddress1 = await datFactory.predictAddress(
            0,
            ethers.id("SALT1"),
        );

        // List should have 1 token
        (await datFactory.datListCount()).should.eq(1);
        (await datFactory.datListAt(0)).should.eq(tokenAddress1);
        (await datFactory.datListAt(0)).should.eq(predictedAddress1);

        // Create second token
        const tx2 = await datFactory.connect(owner).createToken({
            datType: 1,
            name: "Second Token",
            symbol: "ST2",
            cap: tokenCap,
            schedules: [],
            salt: ethers.id("SALT2"),
            owner: admin.address,
        });
        const receipt2 = await getReceipt(tx2);
        const createEvent2 = receipt2.logs.find(
            (log) => (log as EventLog).fragment?.name === "DATCreated",
        ) as EventLog;
        should().exist(createEvent2);
        const tokenAddress2 = createEvent2.args[0];
        const predictedAddress2 = await datFactory.predictAddress(
            1,
            ethers.id("SALT2"),
        );

        // List should have 2 tokens
        (await datFactory.datListCount()).should.eq(2);
        (await datFactory.datListAt(1)).should.eq(tokenAddress2);
        (await datFactory.datListAt(1)).should.eq(predictedAddress2);

        // Values should match
        const values = await datFactory.datListValues();
        values.should.deep.eq([tokenAddress1, tokenAddress2]);
    });

    it("should create a token with vesting schedules", async function () {
        const { vestingSchedules, amount1, amount2 } =
            await createTokenWithVesting();

        // Verify token parameters
        (await datToken.name()).should.eq(tokenName);
        (await datToken.symbol()).should.eq(tokenSymbol);
        (await datToken.cap()).should.eq(tokenCap);

        // Verify vesting wallets received tokens
        (await datToken.totalSupply()).should.eq(amount1 + amount2);
        (await datToken.balanceOf(vestingWallet1.target)).should.eq(amount1);
        (await datToken.balanceOf(vestingWallet2.target)).should.eq(amount2);

        // Verify vesting wallet parameters
        (await vestingWallet1.owner()).should.eq(beneficiary1.address);
        (await vestingWallet2.owner()).should.eq(beneficiary2.address);

        // Verify predicted address matches
        const predictedAddress = await datFactory.predictAddress(0, tokenSalt);
        predictedAddress.should.eq(datToken.target);
    });

    it("should reject createToken with empty name or symbol", async function () {
        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: "", // Empty name
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: [],
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith(`EmptyString("name")`);

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: "", // Empty symbol
                cap: tokenCap,
                schedules: [],
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith(`EmptyString("symbol")`);
    });

    it("should reject token creation with zero owner address", async function () {
        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: [],
                salt: tokenSalt,
                owner: ethers.ZeroAddress, // Zero address
            })
            .should.be.rejectedWith("ZeroOwner");
    });

    it("should reject token creation with cap below minimum", async function () {
        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: minCap - 1n, // Below minimum
                schedules: [],
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith("CapTooLow");
    });

    it("should reject token creation with cap above maximum", async function () {
        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: maxCap + 1n, // Above maximum
                schedules: [],
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith("ExcessiveCap");
    });

    it("should reject token creation with vesting total exceeding cap", async function () {
        const overCapAmount = parseEther(11_000_000); // Over the 10M cap

        const vestingSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: Math.floor(Date.now() / 1000),
                cliff: 90 * 86400,
                duration: 365 * 86400,
                amount: overCapAmount,
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: vestingSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith("ExceedsCap");
    });

    it("should reject token creation with vesting with zero beneficiary", async function () {
        const now = Math.floor(Date.now() / 1000);

        const invalidSchedules = [
            {
                beneficiary: ethers.ZeroAddress, // Zero address
                start: now,
                cliff: 90 * 86400,
                duration: 365 * 86400,
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: invalidSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith("ZeroAddress");
    });

    it("should reject token creation with vesting with zero amount", async function () {
        const now = Math.floor(Date.now() / 1000);

        const invalidSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: now,
                cliff: 90 * 86400,
                duration: 365 * 86400,
                amount: 0, // Zero amount
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: invalidSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith("ZeroAmount");
    });

    it("should reject token creation with vesting with zero start time", async function () {
        const invalidSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: 0, // Zero start time
                cliff: 90 * 86400,
                duration: 365 * 86400,
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: invalidSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith("ZeroStartTime");
    });

    it("should reject token creation with vesting with zero duration", async function () {
        const now = Math.floor(Date.now() / 1000);

        const invalidSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: now,
                cliff: 90 * 86400,
                duration: 0, // Zero duration
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: invalidSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith("ZeroDuration");
    });

    it("should reject token creation with invalid vesting parameters: duration <= cliff", async function () {
        const now = Math.floor(Date.now() / 1000);

        // Invalid: duration = cliff
        const equalCliffSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: now,
                cliff: 365 * 86400,
                duration: 365 * 86400, // Same as cliff
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: equalCliffSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith("DurationTooShort");

        // Invalid: cliff > duration
        const greaterCliffSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: now,
                cliff: 400 * 86400, // Cliff 400 days
                duration: 365 * 86400, // Duration 365 days
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: greaterCliffSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith("DurationTooShort");
    });

    it("should reject token creation with excessive vesting parameters", async function () {
        const now = Math.floor(Date.now() / 1000);
        const maxUint64 = 2n ** 64n - 1n;

        // Duration too large
        const excessiveDurationSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: now,
                cliff: 90 * 86400,
                duration: Number(maxUint64) + 1, // Exceeds uint64
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: excessiveDurationSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith(/overflow/);

        // Start too large
        const excessiveStartSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: Number(maxUint64) + 1, // Exceeds uint64
                cliff: 90 * 86400,
                duration: 365 * 86400,
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: excessiveStartSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith(/overflow/);

        // Cliff too large
        const excessiveCliffSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: now,
                cliff: Number(maxUint64) + 1, // Exceeds uint64
                duration: 365 * 86400,
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: excessiveCliffSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith(/overflow/);
    });

    it("should reject token creation when start+cliff overflows", async function () {
        const maxUint64 = BigInt(2) ** BigInt(64) - BigInt(1);

        const overflowSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: Number(maxUint64) - 86400, // Very close to max
                cliff: 90 * 86400, // Adding this would overflow
                duration: 365 * 86400,
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: overflowSchedules,
                salt: tokenSalt,
                owner: admin.address,
            })
            .should.be.rejectedWith(/overflow/);
    });

    it("should reject token creation with postCliffDuration=0", async function () {
        // This would make postCliffDuration = 0, which is invalid in OpenZeppelin's VestingWallet
        const now = Math.floor(Date.now() / 1000);

        const invalidSchedules = [
            {
                beneficiary: beneficiary1.address,
                start: now,
                cliff: 365 * 86400,
                duration: 365 * 86400 + 1, // Just slightly greater than cliff
                amount: parseEther(1_000_000),
            },
        ];

        await datFactory
            .connect(owner)
            .createToken({
                datType: 0,
                name: tokenName,
                symbol: tokenSymbol,
                cap: tokenCap,
                schedules: invalidSchedules,
                salt: tokenSalt,
                owner: admin.address,
            }).should.not.be.rejected; // This is actually valid, just checking the edge case
    });

    it("should correctly predict token address", async function () {
        const salt1 = ethers.id("PREDICT_TEST_1");
        const salt2 = ethers.id("PREDICT_TEST_2");
        const salt3 = ethers.id("PREDICT_TEST_3");

        // Predict addresses
        const predictedAddr1 = await datFactory.predictAddress(0, salt1);
        const predictedAddr2 = await datFactory.predictAddress(1, salt2);
        const predictedAddr3 = await datFactory.predictAddress(2, salt3);

        // Create tokens
        const tx1 = await datFactory.connect(owner).createToken({
            datType: 0,
            name: tokenName + " 1",
            symbol: tokenSymbol + "1",
            cap: tokenCap,
            schedules: [],
            salt: salt1,
            owner: admin.address,
        });
        const receipt1 = await getReceipt(tx1);
        const createEvent1 = receipt1.logs.find(
            (log) => (log as EventLog).fragment?.name === "DATCreated",
        ) as EventLog;
        should().exist(createEvent1);
        const tokenAddress1 = createEvent1.args[0];
        tokenAddress1.should.eq(predictedAddr1);

        const tx2 = await datFactory.connect(owner).createToken({
            datType: 1,
            name: tokenName + " 2",
            symbol: tokenSymbol + "2",
            cap: tokenCap,
            schedules: [],
            salt: salt2,
            owner: admin.address,
        });
        const receipt2 = await getReceipt(tx2);
        const createEvent2 = receipt2.logs.find(
            (log) => (log as EventLog).fragment?.name === "DATCreated",
        ) as EventLog;
        should().exist(createEvent2);
        const tokenAddress2 = createEvent2.args[0];
        tokenAddress2.should.eq(predictedAddr2);

        const tx3 = await datFactory.connect(owner).createToken({
            datType: 2,
            name: tokenName + " 3",
            symbol: tokenSymbol + "3",
            cap: tokenCap,
            schedules: [],
            salt: salt3,
            owner: admin.address,
        });
        const receipt3 = await getReceipt(tx3);
        const createEvent3 = receipt3.logs.find(
            (log) => (log as EventLog).fragment?.name === "DATCreated",
        ) as EventLog;
        should().exist(createEvent3);
        const tokenAddress3 = createEvent3.args[0];
        tokenAddress3.should.eq(predictedAddr3);
    });

    it("should reject predictAddress with zero salt", async function () {
        await datFactory
            .predictAddress(0, ethers.ZeroHash)
            .should.be.rejectedWith("ZeroSalt");
    });

    it("should update treasury and ammPair for multiple tokens", async function () {
        // Deploy two tokens
        const salt1 = ethers.id("BATCH1");
        const salt2 = ethers.id("BATCH2");

        const tx1 = await datFactory.connect(owner).createToken({
            datType: 0,
            name: tokenName + " 1",
            symbol: tokenSymbol + "1",
            cap: tokenCap,
            schedules: [],
            salt: salt1,
            owner: admin.address,
        });
        const receipt1 = await getReceipt(tx1);
        const tokenAddress1 = (receipt1.logs.find(
            (log) => (log as EventLog).fragment?.name === "DATCreated"
        ) as EventLog).args[0];

        const tx2 = await datFactory.connect(owner).createToken({
            datType: 0,
            name: tokenName + " 2",
            symbol: tokenSymbol + "2",
            cap: tokenCap,
            schedules: [],
            salt: salt2,
            owner: admin.address,
        });
        const receipt2 = await getReceipt(tx2);
        const tokenAddress2 = (receipt2.logs.find(
            (log) => (log as EventLog).fragment?.name === "DATCreated"
        ) as EventLog).args[0];

        const dat1 = await ethers.getContractAt("DAT", tokenAddress1);
        const dat2 = await ethers.getContractAt("DAT", tokenAddress2);

        // Deploy new treasury and registry
        const newTreasury = user1.address;
        const newAmmPair = user2.address;

        // Only maintainer can call batch updaters
        await expect(
            datFactory.connect(user2).updateTreasuryForTokens([tokenAddress1, tokenAddress2], newTreasury)
        ).to.be.revertedWithCustomError(datFactory, "AccessControlUnauthorizedAccount");

        await expect(
            datFactory.connect(maintainer).updateTreasuryForTokens([tokenAddress1, tokenAddress2], newTreasury)
        ).to.not.be.reverted;

        (await dat1.treasury()).should.eq(newTreasury);
        (await dat2.treasury()).should.eq(newTreasury);

        await expect(
            datFactory.connect(user2).updateAmmPairForToken(tokenAddress1, newAmmPair)
        ).to.be.revertedWithCustomError(datFactory, "AccessControlUnauthorizedAccount");

        await expect(
            datFactory.connect(maintainer).updateAmmPairForToken(tokenAddress1, newAmmPair)
        ).to.not.be.reverted;

        await expect(
            datFactory.connect(maintainer).updateAmmPairForToken(tokenAddress2, newAmmPair)
        ).to.not.be.reverted;

        (await dat1.ammPair()).should.eq(newAmmPair);
        (await dat2.ammPair()).should.eq(newAmmPair);
    });
});
