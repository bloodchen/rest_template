import { BaseService } from './common/baseService.js';
export class Pay extends BaseService {
    async init() {

    }
    async regEndpoints(app) {
        app.get('/pay/manage-subscription', async (req, res) => {
            const { aimgr, db } = this.gl
            const uid = await aimgr.getUID(req)
            if (!uid) return { code: 100, msg: ERR.NO_UID }
            const order = await db.getOrder({ uid })
            if (!order) return { code: 101, msg: "no order" }
            const customerId = order.meta.customerId; // 从用户会话中获取 Stripe Customer ID
            res.redirect(`/user/_pay/manage-subscription?cid=${customerId}`); // 重定向到 Customer Portal
        })
        app.get("/pay/plans", async (req, res) => {
            return this.gl.config.plans
        })
        app.post("/pay/createPaymentUrl", async (req, res) => {
            const { axios, aimgr } = this.gl
            const body = req.body
            const test = false
            const uid = await aimgr.getUID(req)
            const url = process.env.commonAPI + "/pay/createPayment"
            const result = await axios.post(url, { ...body, uid, app: process.env.APP_NAME, test })
            return result.data
        })
        app.get('/pay/cancelPlan', async (req, res) => {
            try {
                const { aimgr } = this.gl
                const uid = await aimgr.getUID(req)
                if (!uid) {
                    return { err: 'user-not-login' };
                }
                const user = await this.getUser({ uid });
                user.plan = await this.getPlan({ user })
                if (user.plan.name !== 'free') {
                    return await this.cancelPlan({ user })
                }
                return { err: 'user-not-subscribed' };
            } catch (error) {
                this.gl.logger.error('cancelPlan error', { error: error.message, uid: req.uid });
                return { err: 'internal-server-error' };
            }
        })
    }
}