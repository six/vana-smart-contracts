import { expect, should } from "chai";
import { ethers } from "hardhat";

should();

describe("AMMRegistry", function () {
    let admin: any;
    let registrar: any;
    let user: any;
    let ammRegistry: any;

    beforeEach(async () => {
        [admin, registrar, user] = await ethers.getSigners();
        const AMMRegistry = await ethers.getContractFactory("AMMRegistry");
        ammRegistry = await AMMRegistry.deploy(admin.address);
        await ammRegistry.waitForDeployment();
    });

    it("should deploy and assign roles", async function () {
        (await ammRegistry.hasRole(await ammRegistry.DEFAULT_ADMIN_ROLE(), admin.address)).should.eq(true);
        (await ammRegistry.hasRole(await ammRegistry.REGISTRAR_ROLE(), admin.address)).should.eq(true);
    });

    it("should allow REGISTRAR_ROLE to add and remove pairs", async function () {
        const pair = ethers.Wallet.createRandom().address;
        await expect(ammRegistry.connect(admin).setPair(pair, true))
            .to.emit(ammRegistry, "PairStatusUpdated").withArgs(pair, true);
        (await ammRegistry.isPair(pair)).should.eq(true);

        await expect(ammRegistry.connect(admin).setPair(pair, false))
            .to.emit(ammRegistry, "PairStatusUpdated").withArgs(pair, false);
        (await ammRegistry.isPair(pair)).should.eq(false);
    });

    it("should revert if non-registrar tries to set pair", async function () {
        const pair = ethers.Wallet.createRandom().address;
        await expect(
            ammRegistry.connect(user).setPair(pair, true)
        ).to.be.revertedWithCustomError(ammRegistry, "AccessControlUnauthorizedAccount")
         .withArgs(user.address, await ammRegistry.REGISTRAR_ROLE());
    });

    it("should revert if pair is zero address", async function () {
        await expect(
            ammRegistry.connect(admin).setPair(ethers.ZeroAddress, true)
        ).to.be.revertedWith("AMMRegistry: zero pair");
    });

    it("should allow admin to grant and revoke REGISTRAR_ROLE", async function () {
        await expect(
            ammRegistry.connect(admin).grantRole(await ammRegistry.REGISTRAR_ROLE(), registrar.address)
        ).to.not.be.reverted;
        (await ammRegistry.hasRole(await ammRegistry.REGISTRAR_ROLE(), registrar.address)).should.eq(true);

        await expect(
            ammRegistry.connect(admin).revokeRole(await ammRegistry.REGISTRAR_ROLE(), registrar.address)
        ).to.not.be.reverted;
        (await ammRegistry.hasRole(await ammRegistry.REGISTRAR_ROLE(), registrar.address)).should.eq(false);
    });
}); 