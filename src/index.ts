import ChFax from "./chfax/chfax"
import FaxEvent from "./chfax/faxevent"

async function run() {
    const fm = await FaxEvent.newInstance()
    // await fax.setSession("FFFAB6B6917FB7B2E1AD9D0277912B2A", "MTAw")
}
run()