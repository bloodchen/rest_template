import crypto from 'crypto';
import { BaseService } from "./baseService.js";

export class Util extends BaseService {
    async init(gl) {
        this.tokenPass = process.env.tokenPass || "2rnma5xsc3efx1Z$#%^09FYkRfuAsxTB"
    }
    getClientIp(req) {
        let IP =
            //req.ip ||
            req.headers['cf-connecting-ip'] ||
            req.headers["x-forwarded-for"] ||
            req.socket.remoteAddress ||
            req.connection.remoteAddress ||
            req.connection.socket.remoteAddress;
        IP = IP.split(',')[0]
        //IP = IP.split(":").pop()
        return IP;
    }
    encrypt({ data, password, to_encoding = 'hex', iv, length = 256 }) {
        const buf = Buffer.from(data)
        if (iv) iv = Buffer.from(iv)
        var iv1 = iv || crypto.randomBytes(16)
        var algorithm = `aes-${length}-cbc`;
        var cipher = crypto.createCipheriv(algorithm, Buffer.from(password), iv1)
        var crypted = Buffer.concat([iv1, cipher.update(buf), cipher.final()]);
        return crypted.toString(to_encoding);
    }
    decrypt({ data, password, from_encoding = 'hex', to_encoding = 'utf8', length = 256 }) {
        try {
            const buf = Buffer.from(data, from_encoding)
            var iv = buf.subarray(0, 16)
            var algorithm = `aes-${length}-cbc`;
            var decipher = crypto.createDecipheriv(algorithm, Buffer.from(password), iv)
            var decrypted = Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]);
            return decrypted.toString(to_encoding);
        } catch (e) {
            return null
        }
    }
    async uidToToken({ uid, create, expire }) {
        try {
            const data = JSON.stringify({ uid, create, expire })
            return "0-" + await this.encrypt({ data, password: this.tokenPass, to_encoding: "hex" })
        } catch (e) {
            console.error(e.message)
        }
        return null
    }
    async decodeToken({ token }) {
        try {
            const ver = token.slice(0, 2)
            const data = this.decrypt({ data: token.slice(2), password: this.tokenPass, from_encoding: "hex" })
            const user = JSON.parse(data)
            console.log(user)
            return user || {}
        } catch (e) {
            console.error(e.message)
        }
        return {}
    }
    getCookie({ req, name }) {
        if (!req.cookies) return null
        return req.cookies[name]
    }
    setCookie({ req, res, name, value, path = '/', secure = true, domain = 'root', days, httpOnly = false, sameSite = 'none' }) {
        const expire = days ? days * 24 * 60 * 60 : -1
        const hostParts = (new URL("http://" + req.headers['host'])).hostname.split('.')
        const rootDomain = hostParts.slice(-2).join('.')
        if (domain === 'root') domain = rootDomain
        if (domain !== 'root') domain = '.' + domain
        const options = {
            maxAge: expire,
            httpOnly,
            path,
            domain,
            sameSite,
            secure
        }
        if (!days) delete options.maxAge
        res.setCookie(name, value, options)
    }
    parseJson(data) {
        try {
            return JSON.parse(data)
        } catch (e) {
            return null
        }
    }
}