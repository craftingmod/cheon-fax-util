export class FaxContent {
    public readonly dateid:number
    public readonly uid:BigInt
    public readonly filepath:string
    public name:string
    public receiveTime:number
    public checkTime:number
    public constructor(info:FaxInfo) {
        this.dateid = info.dateid
        this.uid = info.uid
        this.filepath = info.filepath
        this.name = info.name
        this.receiveTime = info.receiveTime
        this.checkTime = info.checkTime
    }
}
export interface FaxInfo {
    dateid:number
    uid:BigInt
    filepath:string
    name:string
    receiveTime:number
    checkTime:number
}