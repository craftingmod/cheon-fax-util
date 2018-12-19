import ChFax from "../chfax"

export class FaxContent implements FaxInfo {
    public readonly dateid:number
    public readonly uid:bigint
    public readonly filepath:string
    public readonly name:string
    public readonly receiveTime:number
    public readonly checkTime:number
    public constructor(info:FaxInfo) {
        this.dateid = info.dateid
        this.uid = info.uid
        this.filepath = info.filepath
        this.name = info.name
        this.receiveTime = info.receiveTime
        this.checkTime = info.checkTime
    }
    public asFaxInfo():FaxInfo {
        return {
            dateid: this.dateid,
            uid: this.uid,
            filepath: this.filepath,
            name: this.name,
            receiveTime: this.receiveTime,
            checkTime: this.checkTime,
        }
    }
    public getElement(index:number | string) {
        const out:{[key in string]: string} = {}
        if (typeof index === "number") {
            if (index < 0) {
                index = ""
            } else {
                index = "0"
            }
        }
        out["hd_keydate" + index] = this.dateid.toString(10)
        out["hd_keyseq" + index] = this.uid.toString()
        out["hd_filename" + index] = this.filepath
        out["hd_memo" + index] = this.name
        return out
    }
    public isMatch(dateid:number, uid:bigint) {
        return this.dateid === dateid && this.uid === uid
    }
}
export interface FaxInfo {
    dateid:number
    uid:bigint
    filepath:string
    name:string
    receiveTime:number
    checkTime:number
}