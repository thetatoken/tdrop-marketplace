const TestExtMath = artifacts.require('TestExtMath')
const Web3 = require('web3')
const provider = new Web3.providers.HttpProvider('http://localhost:18888')
const web3 = new Web3(provider)
const BN = web3.utils.BN

contract('Test ExtMath', (accounts) => {

    let deploy = async contracts => Promise.all(contracts.map(contract => contract.new()))

    it('test log2', async () => {
        let [testExtMath] = await deploy([TestExtMath])
        
        let log0 = await testExtMath.log2(0)
        let log2 = await testExtMath.log2(2)
        let log4 = await testExtMath.log2(4)
        let log8 = await testExtMath.log2(8)
        let log16 = await testExtMath.log2(16)
        let log32 = await testExtMath.log2(32)
        let log64 = await testExtMath.log2(64)
        let log128 = await testExtMath.log2(128)
        let log256 = await testExtMath.log2(256)

        let log13451245 = await testExtMath.log2(13451245)
        let log89238279 = await testExtMath.log2(89238279)
        let log77723723742747 = await testExtMath.log2(77723723742747)

        let largeNumber1 = new BN('1000000003300000000').mul(new BN('983234234223439'))
        let logLargeNumber1 = await testExtMath.log2(largeNumber1)

        let largeNumber2 = new BN('9293297204923424234234253').mul(new BN('7723649247297823984284'))
        let logLargeNumber2 = await testExtMath.log2(largeNumber2)

        let largeNumber3 = new BN('134727285738459813588792389412894123412').mul(new BN('893958949572358238957235823853293593'))
        let logLargeNumber3 = await testExtMath.log2(largeNumber3)

        // console.log("log0:", log0.toNumber())
        // console.log("log2:", log2.toNumber())
        // console.log("log4:", log4.toNumber())
        // console.log("log8:", log8.toNumber())
        // console.log("log16:", log16.toNumber())
        // console.log("log32:", log32.toNumber())
        // console.log("log64:", log64.toNumber())
        // console.log("log128:", log128.toNumber())
        // console.log("log256:", log256.toNumber())

        // console.log("log13451245:", log13451245.toNumber())
        // console.log("log89238279:", log89238279.toNumber())
        // console.log("log77723723742747:", log77723723742747.toNumber())

        // console.log("logLargeNumber1:", logLargeNumber1.toNumber())
        // console.log("logLargeNumber2:", logLargeNumber2.toNumber())
        // console.log("logLargeNumber3:", logLargeNumber3.toNumber())

        assert.equal(log0.toNumber(), 0)
        assert.equal(log2.toNumber(), 1)
        assert.equal(log4.toNumber(), 2)
        assert.equal(log8.toNumber(), 3)
        assert.equal(log16.toNumber(), 4)
        assert.equal(log32.toNumber(), 5)
        assert.equal(log64.toNumber(), 6)
        assert.equal(log128.toNumber(), 7)
        assert.equal(log256.toNumber(), 8)
        assert.equal(log13451245.toNumber(), 24)
        assert.equal(log89238279.toNumber(), 27)
        assert.equal(log77723723742747.toNumber(), 47)
        assert.equal(logLargeNumber1.toNumber(), 110)
        assert.equal(logLargeNumber2.toNumber(), 156)
        assert.equal(logLargeNumber3.toNumber(), 247)
    })
})


 