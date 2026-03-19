import { requireEnv } from '../utils/env'
import { Bundler } from "abstractionkit";

async function main(): Promise<void> {
    const bundlerUrl = requireEnv('BUNDLER_URL')
    const bundler = new Bundler(bundlerUrl)

    //an example for using a bundler json rpc methods other than sendUserOperation and estimateUserOperationGas which is covered in another example
    const userOperationHash = "0xf618a32b863d7f026f0819a039869f8bf282f78848dbbd40ce5fc47f39c7959f" //an example userOperationHash on arbitrum-sepolia
    console.log(await bundler.chainId())
    console.log(await bundler.supportedEntryPoints())
    console.log(await bundler.getUserOperationByHash(userOperationHash))
    console.log(await bundler.getUserOperationReceipt(userOperationHash))
}

main()