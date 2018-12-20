import exec from "await-exec"
import chalk from "chalk"
import childProcess from "child_process"
import enquirer, { prompt } from "enquirer"
import fsPromise from "fs-extra"
import notifier from "node-notifier"
import PDFDocument from "pdfkit"
import printer from "printer"
import read from "read"
import ChFax from "./chfax"
import FaxEvent from "./faxevent"
import { FaxContent } from "./structure/faxcontent"

export class FaxDaemon {
    protected faxEvent:FaxEvent
    protected printName:string
    protected printWhenReceive = true
    protected eListener:(contents:FaxContent[]) => Promise<void>
    public async start(ymdString?:string) {
        if (ymdString != null) {
            const year = Number.parseInt(ymdString.substr(0, 4))
            const month = Number.parseInt(ymdString.substr(4, 2))
            const day = Number.parseInt(ymdString.substr(6, 2))
            this.faxEvent = await FaxEvent.newInstance(new Date(year, month, day).getTime())
        } else {
            this.faxEvent = await FaxEvent.newInstance()
        }
        try {
            const pth = `${FaxEvent.getPath()}/printer.txt`
            await fsPromise.access(pth, fsPromise.constants.R_OK)
            this.printName = await fsPromise.readFile(pth).then((v) => v.toString())
        } catch {
            // :)
        }
        this.eListener = async (contents:FaxContent[]) => {
            notifier.notify({
                title: "새로운 Fax가 왔습니다.",
                message: `${contents.map((v) => v.name).join(", ")}`,
                icon: FaxEvent.getPath().replace(/fax$/i, "baseline_print_white_48dp.png"),
            })
            if (this.printWhenReceive) {
                await this.printFax(contents, false)
            }
        }
        this.faxEvent.on("create", this.eListener)
    }
    public async listen() {
        while (true) {
            /*
            const cmd = await new Promise<string>(async (res, rej) => {
                read({
                    prompt: chalk.rgb(207, 223, 249)("명령어 >"),
                }, (err, result, isDefault) => {
                    if (err != null) {
                        rej(err)
                    } else {
                        res(result)
                    }
                })
            })
            */
            const cmd = await prompt({
                type: "autocomplete",
                name: "cmd",
                message: "명령어 >",
                limit: 10,
                suggest: (input, choices) => choices.filter((choice) => choice.message.startsWith(input)),
                choices: [
                    "exit",
                    "help",
                    "print",
                    "setprinter",
                    "time",
                ],
            } as any).then((ask) => ask["cmd"])
            const handle = await this.handleCommand(cmd)
            if (handle) {
                break
            }
        }
        process.exit(0)
    }
    protected async handleCommand(type:string) {
        this.reset()
        if (type === "exit") {
            return true
        }
        if (type === "help") {
            const printCommand = (cmd:string, desc:string) =>
                console.log(`${chalk.rgb(249, 202, 134)(cmd)}: ${chalk.rgb(255, 231, 196)(desc)}`)
            printCommand("exit", "종료합니다.")
            printCommand("print", "문서를 프린터기로 출력합니다.")
            printCommand("setprinter", "출력할 프린터기를 선택합니다.")
            printCommand("와", "샌즈")
            // not implemented
        } else if (type === "print") {
            // print selected things
            if (this.printName == null) {
                console.log("프린터가 지정되어 있지 않습니다.")
            }
            const list:FaxContent[] = []
            for (const fax of this.faxEvent.faxes.values()) {
                list.push(fax)
            }
            const names = list.map((v) => ({
                name: v.uidString,
                message: `${chalk.rgb(247, 185, 208)(v.dateid.toString())}${
                    chalk.rgb(197, 232, 176)(v.uid.toString())}\t${
                    v.name.substr(0, Math.min(v.name.length, 30))
                    }`,
            }))
            const res = await prompt<{ selects:string[] }>({
                type: "multiselect",
                name: "selects",
                message: "프린터할 문서를 선택해주세요. (Space 선택, Enter 확인)",
                choices: names,
            })
            this.reset()
            const selects = res.selects.map(
                (v) => this.faxEvent.faxes.get(BigInt(v)))
            if (this.printFax(selects, true)) {
                console.log(chalk.redBright("프린트 성공"))
            }
        } else if (type === "setprinter") {
            const printers:Array<{ name:string }> = printer.getPrinters()
            const names = printers.map((v) => v.name)
            const res = await prompt<{ selected:string }>({
                type: "select",
                name: "selected",
                message: "사용할 프린터 기기를 선택해주세요",
                choices: names,
            })
            this.printName = res.selected
            fsPromise.writeFile(`${FaxEvent.getPath()}/printer.txt`, this.printName)
        } else if (type.startsWith("day")) {
            const date = type.match(/\d{8,8}/ig)
            if (date != null) {
                this.faxEvent.off("create", this.eListener)
                await this.start(date[0])
                console.log(chalk.redBright("아마도 설정완료!"))
            }
        }
        return false
    }
    /**
     * Print Fax Content
     * @param contents Fax Contents
     * @param printHeader Infomation at first
     */
    protected async printFax(contents:FaxContent[], printHeader = true) {
        const prints:string[] = []
        for (const select of contents) {
            if (select == null) {
                console.error(new Error("select is null!"))
                continue
            }
            for (const png of select.images) {
                prints.push(png)
            }
        }
        if (prints.length >= 1 && contents.length >= 1) {
            const doc = new PDFDocument()
            const docpath = FaxEvent.getPath() + "/temp.pdf"
            try {
                await fsPromise.access(docpath, fsPromise.constants.R_OK | fsPromise.constants.W_OK)
                await fsPromise.unlink(docpath)
            } catch (err) {
                // :)
            }
            doc.pipe(fsPromise.createWriteStream(docpath))
            doc.registerFont("NanumBarunGothic", FaxEvent.getPath().replace(/fax$/i, "NanumBarunGothic.ttf"))
            // doc.setEncoding("utf8")
            const did = contents[0].dateid
            const dyear = Math.floor(did / 10000)
            const dmonth = Math.floor((did % 10000) / 100)
            const dday = did % 100
            if (printHeader) {
                doc.font("NanumBarunGothic")
                doc.fontSize(40)
                    .text(`# ${ChFax.toYMD(new Date(dyear, dmonth, dday).getTime())}\n`)
                doc.fontSize(20).text("\n")
                doc.fontSize(40).text("* 팩스 정보\n")
                doc.fontSize(20)
                    .text("\n" + contents.map((v, i) => `${i + 1}) ${v.name}`).join("\n"))
            }
            let first = !printHeader
            for (const fax of contents) {
                for (const png of fax.images) {
                    if (first) {
                        doc.fontSize(15).text(fax.name, 0, 0)
                        first = false
                    } else {
                        doc.addPage().fontSize(15).text(fax.name, 0, 0)
                    }
                    doc.image(png, 0, 15, {
                        width: 600,
                        height: 600 * 277 / 210 - 20,
                    })
                }
            }
            doc.end()
            try {
                await fsPromise.access(docpath, fsPromise.constants.R_OK)
                /*
                const jobid:number | string = await new Promise((rsv, rej) => {
                    if (process.platform !== "win32") {
                        printer.printDirect({
                            filename: docpath,
                            printer: this.printName,
                            success: rsv,
                            error: rej,
                        })
                    } else {
                        printer.printDirect({
                            data,
                            printer: this.printName,
                            success: rsv,
                            error: rej,
                        })
                    }
                })
                */
                // no way to print. use native binary instead
                if (process.platform !== "win32") {
                    try {
                        await exec(`lpr -h -P ${this.printName} ${docpath}`)
                        return true
                    } catch (err) {
                        console.error(err)
                    }
                } else {
                    console.log("Sorry, not support.")
                }
            } catch (err) {
                console.error(err)
            }
            return false
        } else {
            return false
        }
    }
    protected reset() {
        process.stdout.write("\x1Bc")
    }
}