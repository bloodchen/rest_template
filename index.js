import fastifyModule from 'fastify';
import cors from '@fastify/cors'
import dotenv from "dotenv";
import { Config } from './config.js';
import { Util } from './common/util.js';


const app = fastifyModule({ logger: false });
const gl = {}
gl.logger = console
gl.app = app
gl.config = Config
async function onExit() {
    console.log("exiting...")
    process.exit(0);
}
async function startServer() {
    const port = process.env.port || 8080
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`Starting ${Config.project.name} service on:`, port)
}
dotenv.config({path:"env"})
async function main() {
    await regEndpoints()
    //create more classes here
    await Util.create(gl)
    await startServer()
    process.on('SIGINT', onExit);
    process.on('SIGTERM', onExit);
}
async function regEndpoints(){
    await app.register(cors, { origin: true, credentials: true, allowedHeaders: ['content-type'] });
    app.addHook("preHandler", async (req, res) => {
        console.log(req.url)
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
}
main()
