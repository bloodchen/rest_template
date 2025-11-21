import fastifyModule from 'fastify';
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fasticookie from '@fastify/cookie'
import axios from 'axios'

import dotenv from "dotenv";
import path from 'path';
import { fileURLToPath } from 'url';

import { Logger } from './logger.js';
import { Config } from './config.js';
import { Util } from './common/util.js';

dotenv.config({ path: "env" })
const app = fastifyModule({ logger: false });
const gl = {}
// 创建默认logger实例
const logger = new Logger({
    serviceName: process.env.APP_NAME || 'rest-template',
    logDir: process.env.LOG_DIR || './logs'
});
gl.logger = logger
gl.app = app
gl.config = Config
gl.axios = axios
async function onExit() {
    console.log("exiting...")
    process.exit(0);
}
async function startServer() {
    const port = process.env.PORT || 8080
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Starting ${process.env.APP_NAME} service on:`, port)
}

async function main() {
    // 注册静态文件服务
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    gl.appPath = __dirname
    await regEndpoints()
    //create more classes here
    await Util.create(gl)
    if (process.env.Modules.indexOf("redis") != -1) {
        const { Redis } = await import('./redis.js')
        await Redis.create(gl)
    }
    if (process.env.Modules.indexOf("user") != -1) {
        const { DB } = await import('./db.js')
        await DB.create(gl)
        const { User } = await import('./user.js')
        await User.create(gl)
    }

    await startServer()
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
}
async function regEndpoints() {

    await app.register(fastifyStatic, {
        root: path.join(gl.appPath, 'static'),
        prefix: '/static/'
    });
    await app.register(fasticookie)


    await app.register(cors, { origin: true, credentials: true, allowedHeaders: ['content-type'] });
    app.addHook("preHandler", async (req, res) => {
        console.log(req.url)
        if (req.query._testuid) {
            req.uid = Number(req.query._testuid)//req.query.uid
            return
        }
    })
    app.get('/', (req, res) => {
        console.log(req.url)
        return Config.project.name
    })
    app.get('/test', async (req, res) => {

        return "ok"
    })
    app.post('/logSearch', async (req, res) => {
        const body = req.body
        console.log(body)
        return "ok"
    })
    app.post('/notify/_commonapi', async (req, res) => {
        const body = req.body
        console.log(body)
        const { cmd, result } = body
        const { event, data } = body
        if (event === 'login_success') {
            const { user } = gl
            await user.handleLoginSuccessful_fromCommonAPI(data)
        }
        if (event === 'order_paid') {
            const { user } = gl
            await user.handleOrderPaid_fromCommonAPI(data)
        }
        return "ok"
    })
    app.get('/start/maxthon', async (req, res) => { //support auto login from maxthon
        const { access_token } = req.query
        const { user_id: uid, email } = (await axios.get(`https://api.maxthon.com/util/_getUserByAccessToken?access_token=${access_token}`))?.data
        if (!uid) {
            res.redirect('https://mail.uu.me/')
            return
        }
        const user = await gl.user.ensureUser({ uid, email })
        const key = await gl.util.uidToToken({ uid: user.uid, create: Date.now(), expire: Date.now() + 1000 * 3600 * 24 * 30 })
        gl.util.setCookie({ req, res, name: `${process.env.APP_NAME}_ut`, value: key, days: 30, secure: true })

        console.log('/auth/maxthon success key:', key)
        res.redirect('https://mail.uu.me/dashboard')
    })
}
main()
