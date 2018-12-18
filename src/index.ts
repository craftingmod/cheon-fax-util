import ChFax from "./chfax/chfax"

async function run() {
    const fax = new ChFax()
    if (!await fax.login()) {
        console.error("인증 실패")
        return
    }
    // await fax.setSession("FFFAB6B6917FB7B2E1AD9D0277912B2A", "MTAw")
    await fax.loadMain()
    await fax.listFax(new Date(2018, 12, 16).getTime())
}
run()