import ChFax from "./chfax/chfax"
import { FaxDaemon } from "./chfax/faxdaemon"
import FaxEvent from "./chfax/faxevent"

async function run() {
    const daemon = new FaxDaemon()
    daemon.start()
    // await fax.setSession("FFFAB6B6917FB7B2E1AD9D0277912B2A", "MTAw")
}
run()