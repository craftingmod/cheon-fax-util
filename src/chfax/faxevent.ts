import chokidar from "chokidar"
import { EventEmitter } from "events"
import fs from "fs"
import fsPromise from "fs-extra"
import path from "path"
import request from "request-promise-native"
import sharp from "sharp"
import ChFax from "./chfax"
import { FaxContent } from "./structure/faxcontent"

export default class FaxEvent extends EventEmitter {
    public static async newInstance() {
        const ev = new FaxEvent()
        await ev.init()
        return ev
    }
    public static saveDir(fax?:FaxContent):string {
        let rootDir = path.resolve(process.cwd())
        if (!rootDir.endsWith("cheon-fax-util")) {
            rootDir = path.resolve(".")
            if (rootDir.endsWith("build")) {
                rootDir = path.resolve("..")
            }
        }
        return path.resolve(rootDir,`fax${fax == null ? "" : "/" + fax.dateid}`)
    }
    protected lastDate:number = 0
    protected lastUid:bigint = 0n
    protected timer:NodeJS.Timeout
    protected fax:ChFax
    protected contents:Map<bigint, FaxContent>
    protected watcher:chokidar.FSWatcher
    protected constructor() {
        super()
        this.fax = new ChFax()
        this.contents = new Map()
    }
    protected async init() {
        if (!await this.fax.login()) {
            throw new Error("Login failed.")
        }
        this.on("create", this.syncDir.bind(this))
        this.on("init", this.syncDir.bind(this))
        await this.checkNew(true)
        this.timer = setTimeout(() => this.checkNew(), 30000)
        this.watcher = chokidar.watch(FaxEvent.saveDir(), {
            ignored: /.+\.png/i,
        })
        this.watcher.on("change", (p:string) => this.syncName(p))
    }
    protected async checkNew(first = false) {
        const faxes = await this.fax.listFax()
        const alerts:FaxContent[] = []
        for (const fax of faxes) {
            if (fax.dateid >= this.lastDate && fax.uid > this.lastUid && (first || fax.checkTime >= 0)) {
                this.lastDate = fax.dateid
                this.lastUid = fax.uid
                alerts.push(fax)
            }
        }
        if (alerts.length >= 1) {
            this.emit(first ? "init" : "create", alerts)
        }
        if (this.timer != null) {
            clearTimeout(this.timer)
        }
        this.timer = setTimeout(() => this.checkNew(), 30000)
        console.log(alerts.length)
    }
    private async syncName(p:string) {
        const json = JSON.parse((await fsPromise.readFile(p)).toString())
        let purePath = p.replace(FaxEvent.saveDir() + "/", "")
        purePath = purePath.substring(0, purePath.indexOf("/"))
        const editDate = BigInt(purePath)
        const toEdit:FaxContent[] = []
        for (const [key, value] of this.contents.entries()) {
            if ((key - editDate) % 100000000n === 0n) {
                // match
                const k = value.uid + ""
                if (json[k] != null && value.name !== json[k]) {
                    const clone = new FaxContent({
                        ...value.asFaxInfo(),
                        name: json[k],                        
                    })
                    toEdit.push(clone)
                }
            }
        }
        for (const value of toEdit) {
            await this.fax.changeName(value, value.name)
        }
        await this.checkNew()
    }
    private async syncDir(contents:FaxContent[]) {
        let faxPath:string = null
        let fileList:string[] = null
        const exportMap:Map<number, {[key in string | number]:string}> = new Map()
        for (const fax of contents) {
            const nPath = FaxEvent.saveDir(fax)
            // number prefix to identifier
            const prefix = fax.uid + "-"
            // make directory & read list first.
            if (faxPath !== nPath) {
                faxPath = nPath
                try {
                    await fsPromise.access(faxPath, fs.constants.R_OK)
                } catch {
                    await fsPromise.mkdir(faxPath)
                }
                fileList = await fsPromise.readdir(faxPath)
            }
            const faxFilename = prefix + fax.name.replace(/[\/\\?%*:|"<>]+/ig, "_")
            const faxImage = `${faxFilename}.0.png`
            const extFilenames = fileList.filter((v) => v.startsWith(prefix))
            // file not exists && other file with prefix exists
            if (extFilenames.indexOf(faxImage) < 0) {
                if (extFilenames.length >= 1) {
                    try {
                        await Promise.all(extFilenames.map((v) => fsPromise.unlink(`${nPath}/${v}`)))
                    } catch (err) {
                        console.error(err)
                    }
                }
                for (let i = 0; true; i += 1) {
                    try {
                        const byteImage = await sharp(
                            (await request.get(fax.filepath, {encoding: null})) as Buffer, {
                                failOnError: true,
                                page: i,
                            }).png().toBuffer()
                        await fsPromise.writeFile(`${nPath}/${faxFilename}.${i}.png`, byteImage, {encoding: null})
                    } catch (err) {
                        // console.error(err)
                        break
                    }
                }
            }
            const nid = BigInt(fax.uid + "" + fax.dateid)
            this.contents.set(nid, fax)
            const tid = fax.dateid
            if (!exportMap.has(tid)) {
                exportMap.set(tid, {})
            }
            exportMap.get(tid)[fax.uid.toString(10)] = fax.name
        }
        // export file
        for (let [tid, exportObj] of exportMap.entries()) {
            const faxTitle = `${FaxEvent.saveDir()}/${tid}/0faxinfo.txt`
            try {
                await fsPromise.access(faxTitle, fs.constants.R_OK)
                const json = JSON.parse((await fsPromise.readFile(faxTitle)).toString("utf-8"))
                exportObj = {
                    ...json,
                    ...exportObj,
                }
            } catch {
                // no exists hmm
            }
            await fsPromise.writeFile(faxTitle, JSON.stringify(exportObj, null, 4))
        }
    }
}