import cheerio from "cheerio"
import encoding from "encoding"
import entities from "html-entities"
import http from "http"
import path from "path"
import querystring from "querystring"
import req, { Cookie } from "request"
import request from "request-promise-native"
import { FaxContent } from "./structure/faxcontent"

type ParamArray = {[key in string]:string}
const ip = "108.1.14.160"
const port = 8080
const prefix = `http://${ip}:${port}/ums`
const loginForm = `${prefix}/Login.do`
const loginMain = `${prefix}/LoginForm.do`
const listForm = `${prefix}/FsReceivedSearch.do`
const mainForm = `${prefix}/MainStartForm.do`
const memoForm = `${prefix}/FsReceivedMemoSave.do`
const defaultid = "환경정책"
const defaultpw = "1"
export default class ChFax {
    public static toYMD(stamp:number, sep = "") {
        const date = new Date(stamp)
        return `${date.getFullYear()}${sep}${
            (date.getMonth() + 1).toString(10).padStart(2, "0")}${sep}${
            date.getDate().toString(10).padStart(2, "0")}`
    }
    private static encode(str:string | Buffer,
        fromEncoding:"utf-8" | "euc-kr", toEncoding:"utf-8" | "euc-kr" = "utf-8"):Buffer {
        return encoding.convert(str, toEncoding, fromEncoding)
    }
    private static encodeEUCKR(str:string) {
        const encoder = (value:string) => {
            const bf = Buffer.from(value, "utf8")
            const eucBf:Buffer = this.encode(bf, "utf-8", "euc-kr")
            const hexes:string[] = []
            for (let i = 0; i < eucBf.byteLength; i += 1) {
                hexes.push(eucBf.readUInt8(i).toString(16).padStart(2, "0").toUpperCase())
            }
            return "%" + hexes.join("%")
        }
        let out = str
        // space -> plus
        out = out.replace(/\s/ig, "+")
        // const uriRegex = /[A-Z a-z 0-9 ; , \/ ? : @ & = + $ \- _ . ! ~ * ' ( ) #]+/ig
        const uriRegex = /[A-Z a-z 0-9]+/ig
        const escape = out.match(uriRegex)
        if (escape == null) {
            return encoder(str)
        } else {
            const joined:string[] = []
            const breaked = out.split(uriRegex)
            for (let i = 0; i < breaked.length; i += 1) {
                joined.push(encoder(breaked[i]))
                if (i < escape.length) {
                    joined.push(escape[i])
                }
            }
            return joined 
        }
    }
    private static parseTime(str:string) {
        const ymdSearch = /\d{4,4}-\d{1,2}-\d{1,2}/i
        if (ymdSearch.test(str)) {
            const [year, month, day] = str.match(ymdSearch)[0].split("-").map((v) => Number.parseInt(v))
            let hour:number = 0
            let minute:number = 0
            let second:number = 0
            const hmsStr = str.replace(ymdSearch, "").trim().split(":")
            for (let i = 0; i < Math.min(hmsStr.length, 3); i += 1) {
                const n = Number.parseInt(hmsStr[i])
                switch (i) {
                    case 0 : hour = n; break
                    case 1 : minute = n; break
                    case 2 : second = n; break
                }
            }
            return new Date(year, month, day, hour, minute, second).getTime()
        }
        return -1
    }
    public fetchCount = 12
    protected rawCookies:{[key in string]:Cookie}
    protected agent:http.Agent
    protected id:string
    protected pw:string
    public constructor(id:string = defaultid, pw:string = defaultpw) {
        this.id = id
        this.pw = pw
    }
    /**
     * Request with EUC-KR parameters
     * @param url URL for request
     * @param form Form data JSON
     */
    public async reqPost(url:string, form:{[key in string]: Serializable}, referer?:string) {
        return this.reqGen("POST", url, {
            body: querystring.stringify(form, "&", "=", { encodeURIComponent: (v:string) => v }),
        }, referer)
    }
    public async reqGet(url:string, qs?:{[key in string]:string | number | boolean}, referer?:string) {
        return this.reqGen("GET", url, {
            qs: qs == null ? "" : querystring.stringify(
                qs, "&", "=", { encodeURIComponent: (v:string) => v }),
        }, referer)
    }
    public async reqGen(type:"POST" | "GET", url:string, param:request.RequestPromiseOptions, referer?:string) {
        const cookie = this.makeCookie()
        const rq = await request(url, {
            method: type,
            encoding: null,
            useQuerystring: true,
            resolveWithFullResponse: true,
            agent: this.agent,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko",
                "Referer": referer,
                "Host": `${ip}:${port}`,
                "Content-Type": type === "POST" ? "application/x-www-form-urlencoded" : undefined,
            },
            jar: cookie,
            ...param,
        })
        const result = ChFax.encode(rq.body, "euc-kr", "utf-8").toString()
        for (const ck of cookie.getCookies(prefix)) {
            ck.setMaxAge(Infinity)
            this.rawCookies[ck.key] = ck
        }
        return result
    }
    /**
     * Login to fax system
     * @returns Login result (success or fail)
     */
    public async login() {
        this.rawCookies = {}
        this.agent = new http.Agent({
            keepAlive: true,
            maxSockets: 1,
            keepAliveMsecs: Infinity,
        })
        await this.reqGet(loginMain)
        const tryLogin = () => this.reqPost(loginForm, {
            "tf_usid": ChFax.encodeEUCKR(this.id),
            "tf_pwd": this.pw,
        }, loginMain)
        const res = await tryLogin()
        if (res.startsWith("<META HTTP-EQUIV='REFRESH'")) {
            console.log(res)
            // success
            return true
        } else {
            console.log("Failed.")
            return false
        }
    }
    public async loadMain() {
        const resList = await this.reqGet(mainForm, null, loginForm)
        const $ = cheerio.load(resList)
        // DOM 참고
        const ui = $(".UserInfo")
        const username = $(".12d_b > b").text().trim()
        const usergroup = $(ui).find("tr:nth-child(4)").text().trim()
        let timestamp = Date.now()
        const now = new Date(timestamp)
        const time = $(ui).find("tr:nth-child(3)").text().trim()
        if (time.length >= 3 && time.split(":").length === 3) {
            const [h, m, s] = time.split(":").map((v) => Number.parseInt(v))
            timestamp = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, s).getTime()
        }
        console.log(`un: ${username}, ug: ${usergroup}, ts: ${timestamp}`)
        // ID가 없어서 attr로 검색
        const countDOM = $("table[background='/ums/images/main/notice_fax_info.gif']").find("tbody > tr:nth-child(2)")
        const todayFax = Number.parseInt($(countDOM).find("td:nth-child(2) > font:nth-child(2)").text().trim())
        const totalFax = Number.parseInt($(countDOM).find("td:nth-child(2) > font:nth-child(1)").text().trim())
        return {
            /**
             * 유저 이름
             */
            username,
            /**
             * 부서
             */
            usergroup,
            /**
             * 접속 시간 (UTC+9, 타임스탬프)
             */
            timestamp,
            /**
             * 오늘의 팩스량
             */
            todayFax,
            /**
             * 총 팩스량
             */
            totalFax,
        }
    }
    /**
     * Fetch faxes ordered by `[0] old -> new [last]`
     * @param before The time search before (day)
     * @param after The time search after (day)
     */
    public async listFax(before = Date.now(), after = Date.now()) {
        // document.getElementById('date1').value=20181217&document.getElementById('date2').value=20181218
        const fetchFaxes = async (page:number = 1) => {
            const pm = {}
            const startDate = new Date(Math.min(before, after))
            const endDate = new Date(Math.max(before, after))
            pm[encodeURI("document.getElementById('date1').value")] = ChFax.toYMD(startDate.getTime())
            pm[encodeURI("document.getElementById('date2').value")] = ChFax.toYMD(endDate.getTime())
            const paramURL = querystring.stringify(pm, "&", "=", {encodeURIComponent: (v:string) => v})
            const addZero = (n:number) => n.toString(10).padStart(2, "0")
            const param = {
                hd_page: page + "",
                hd_checkcnt: this.fetchCount,
                hd_FrYear: startDate.getFullYear() + "",
                hd_FrMon: addZero(startDate.getMonth() + 1),
                hd_FrDay: addZero(startDate.getDate()),
                hd_ToYear: endDate.getFullYear() + "",
                hd_ToMon: addZero(endDate.getMonth() + 1),
                hd_ToDay: addZero(endDate.getDate()),
                date1: ChFax.toYMD(startDate.getTime(), "/"),
                date2: ChFax.toYMD(endDate.getTime(), "/"),
                hd_searchFlag: "all",
            }
            const resList = await this.reqPost(`${listForm}?${paramURL}`, param)
            const $ = cheerio.load(resList)
            // tslint:disable-next-line
            const parent = $("table[height='440']")
            const contents:FaxContent[] = parent.find("tr:nth-child(2n+1)").map((_i, el) => {
                const i = _i + 1
                const selectKey = (key:string) => $(el).find(`input[name='${key}${i}']`).val()
                if (selectKey("hd_keyseq") === undefined) {
                    return null
                }
                const keydate = Number.parseInt(selectKey("hd_keydate"))
                const keyuid = BigInt(selectKey("hd_keyseq"))
                const keyname = selectKey("hd_filename")
                const name = $(el).find("a").text().trim()
                const createTime = ChFax.parseTime($(el).find("td:nth-child(4)").text().trim())
                const checkTime = ChFax.parseTime($(el).find("td:nth-child(5)").text().trim())
                return new FaxContent({
                    dateid: keydate,
                    uid: keyuid,
                    name,
                    filepath: `http://${ip}:${port}${keyname}`,
                    receiveTime: createTime,
                    checkTime,
                })
            }).get().filter((v) => v != null)
            return contents
        }
        let index = 1
        const faxes:FaxContent[] = []
        while (true) {
            const fetch = await fetchFaxes(index)
            faxes.unshift(...fetch)
            if (fetch.length < this.fetchCount) {
                break
            }
            index += 1
        }
        faxes.sort((a, b) => {
            if (a.dateid !== b.dateid) {
                return a.dateid - b.dateid
            } else {
                const delta = a.uid - b.uid
                if (delta > 0n) {
                    return 0.5
                } else if (delta < 0n) {
                    return -0.5
                } else {
                    return 0
                }
            }
        })
        for (const fax of faxes) {
            console.log(fax.name)
        }
        return faxes
    }
    /**
     * Change 
     * @param fax 
     * @param toName 
     */
    public async changeName(fax:FaxContent, toName:string) {
        await this.reqPost(memoForm, {
            ...fax.getElement(-1),
            hd_memo: ChFax.encodeEUCKR(toName),
        }, listForm)
    }
    protected makeCookie() {
        const reqCookie = request.jar()
        for (const [key, value] of Object.entries(this.rawCookies)) {
            reqCookie.setCookie(value, prefix + "/")
        }
        return reqCookie
    }
}

/**
 * Serializable type defintion.
 */
export type Serializable = string | number | boolean | SerializeObject | SerializeArray
/**
 * Serializable - object
 */
interface SerializeObject {
    [x:string]: Serializable;
}
/**
 * Serializable - array
 */
interface SerializeArray extends Array<Serializable> { }