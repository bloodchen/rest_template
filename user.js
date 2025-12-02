import { BaseService } from './common/baseService.js';
import crypto from 'crypto';

export class User extends BaseService {
  constructor() {
    super();
    this.tableName = 'users';
  }

  /**
   * 初始化用户服务
   * @param {Object} gl - 全局对象
   * @returns {Promise<string|null>} 错误信息或null
   */
  async init(gl) {
    try {
      const { logger, db } = gl;

      if (!db) {
        return '数据库服务未初始化';
      }

      logger.info('用户服务初始化成功');
      return null;
    } catch (error) {
      return `用户服务初始化失败: ${error.message}`;
    }
  }

  /**
   * 密码加密
   * @param {string} password - 原始密码
   * @param {string} OTT - 盐值（可选）
   * @returns {Object} 包含加密密码和盐值的对象
   */
  hashPassword(password, OTT = null) {
    if (!OTT) {
      OTT = crypto.randomBytes(16).toString('hex');
    }

    const hash = crypto.pbkdf2Sync(password, OTT, 10000, 64, 'sha512').toString('hex');
    return {
      hash: `${OTT}:${hash}`,
      OTT
    };
  }

  /**
   * 验证密码
   * @param {string} password - 输入的密码
   * @param {string} hashedPassword - 存储的加密密码
   * @returns {boolean} 密码是否正确
   */
  verifyPassword(password, hashedPassword) {
    try {
      const [OTT, hash] = hashedPassword.split(':');
      const verifyHash = crypto.pbkdf2Sync(password, OTT, 10000, 64, 'sha512').toString('hex');
      return hash === verifyHash;
    } catch (error) {
      this.gl.logger.error('密码验证失败', { error: error.message });
      return false;
    }
  }

  /**
   * 生成随机密码
   * @param {number} length - 密码长度，默认16位
   * @returns {string} 随机密码
   */
  generateRandomPassword(length = 16) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let password = '';

    for (let i = 0; i < length; i++) {
      const randomIndex = crypto.randomInt(0, charset.length);
      password += charset[randomIndex];
    }

    return password;
  }

  /**
   * 获取第三方应用名称
   * @param {number} frm - 第三方应用ID
   * @returns {string} 应用名称
   */
  getFromName(frm) {
    const fromMap = {
      1: 'Magic Link',
      2: 'Google',
      3: 'Maxthon'
    };

    return fromMap[frm] || `Unknown(${frm})`;
  }

  /**
   * 创建用户
   * @param {Object} userData - 用户数据
   * @returns {Promise<Object>} 创建的用户信息（不包含密码）
   */
  async createUser({ email, password, frm = 0, info = {}, status = 1 }) {
    const { db, logger } = this.gl
    if (!email) {
      throw new Error('邮箱不能为空');
    }

    // 如果有from参数但没有password，生成随机密码
    let finalPassword = password;
    if (frm && frm > 0 && !password) {
      finalPassword = this.generateRandomPassword();
      this.gl.logger.info('为第三方用户生成随机密码', {
        email,
        frm,
        fromName: this.getFromName(frm)
      });
    } else if (!password) {
      throw new Error('密码不能为空');
    }

    // 检查邮箱是否已存在
    const existingUser = await db.findOne(
      'SELECT uid FROM users WHERE email = $1',
      [email]
    );

    if (existingUser) {
      throw new Error('邮箱已被注册');
    }

    // 加密密码
    const { hash } = this.hashPassword(finalPassword);

    // 插入用户
    const newUser = await db.insert('users', {
      email,
      pass: hash,
      frm,
      info: JSON.stringify(info),
      status
    });

    logger.info('用户创建成功', {
      uid: newUser.uid,
      email: newUser.email,
      frm: newUser.frm
    });

    // 返回用户信息（不包含密码）
    const { pass, ...userInfo } = newUser;
    return userInfo;
  }
  async handleOTT({ OTT, uid }) {
    const { db, util } = this.gl
    const OTTStr = await db.getKV(OTT)
    if (!OTTStr) return null
    const OTTObj = JSON.parse(OTTStr)
    //await db.delKV(OTT)
    if (!OTTObj) return null
    const { type, email, picture, avatar_url } = OTTObj
    let user = {}

    if (type === 'google') {
      user = await this.ensureUser({ email, frm: 1, uid, info: { avatar: picture } })
    }
    if (type === 'maxthon') {
      if (!email) email = 'non-exist@non-exist.ooo'
      user = await this.ensureUser({ email, frm: 2, uid, info: { avatar: avatar_url } })
    }
    if (type === 'email') {
      user = await this.ensureUser({ email, frm: 3, uid, info: {} })
    }
    return user
  }
  /**
   * 用户登录验证
   * @param {string} email - 邮箱
   * @param {string} password - 密码
   * @param {string} OTT - one time login code
   * @returns {Promise<Object|null>} 用户信息或null
   */
  async authenticateUser({ email, password }) {
    if (!OTT && (!email || !password)) {
      throw new Error('邮箱和密码不能为空');
    }
    let verifyPass = true
    const user = await this.gl.db.findOne(
      'SELECT * FROM users WHERE email = $1 AND status = 1',
      [email]
    );

    if (!user) {
      this.gl.logger.warn('登录失败：用户不存在或已禁用', { email });
      return null;
    }
    if (verifyPass) {
      const isValidPassword = this.verifyPassword(password, user.pass);
      if (!isValidPassword) {
        this.gl.logger.warn('登录失败：密码错误', { email, uid: user.uid });
        return null;
      }
    }
    this.gl.logger.info('用户登录成功', {
      uid: user.uid,
      email: user.email
    });
    // 返回用户信息（不包含密码）
    const { pass, ...userInfo } = user;
    return userInfo;
  }

  /**
   * 根据邮箱或UID获取用户信息
   * @param {Object} params - 查询参数
   * @param {string} params.email - 邮箱（可选）
   * @param {number} params.uid - 用户ID（可选）
   * @returns {Promise<Object|null>} 用户信息或null
   */
  async getUser({ email, uid }) {
    if (!email && !uid) {
      throw new Error('必须提供邮箱或用户ID');
    }

    let query, params;

    if (uid) {
      query = 'SELECT uid, email, frm, info, created_at, updated_at, status FROM users WHERE uid = $1';
      params = [uid];
    } else {
      query = 'SELECT uid, email, frm, info, created_at, updated_at, status FROM users WHERE email = $1';
      params = [email];
    }

    const user = await this.gl.db.findOne(query, params);
    return user;
  }
  /**
   * 更新用户信息
   * @param {number} uid - 用户ID
   * @param {Object} updateData - 更新的数据
   * @returns {Promise<Object>} 更新后的用户信息
   */
  async updateUser(uid, updateData) {
    const allowedFields = ['email', 'frm', 'info', 'status'];
    const updateFields = {};

    // 过滤允许更新的字段
    for (const field of allowedFields) {
      if (updateData.hasOwnProperty(field)) {
        if (field === 'info' && typeof updateData[field] === 'object') {
          updateFields[field] = JSON.stringify(updateData[field]);
        } else {
          updateFields[field] = updateData[field];
        }
      }
    }

    if (Object.keys(updateFields).length === 0) {
      throw new Error('没有有效的更新字段');
    }

    // 如果更新邮箱，检查是否已存在
    if (updateFields.email) {
      const existingUser = await this.gl.db.findOne(
        'SELECT uid FROM users WHERE email = $1 AND uid != $2',
        [updateFields.email, uid]
      );

      if (existingUser) {
        throw new Error('邮箱已被其他用户使用');
      }
    }

    const updatedUser = await this.gl.db.update('users', updateFields, { uid });

    if (!updatedUser) {
      throw new Error('用户不存在');
    }

    this.gl.logger.info('用户信息更新成功', {
      uid,
      updatedFields: Object.keys(updateFields)
    });

    // 返回用户信息（不包含密码）
    const { pass, ...userInfo } = updatedUser;
    return userInfo;
  }

  async getUserInfo({ uid }) {
    const user = await this.getUser({ uid });
    if (!user) {
      return { err: "user-not-found" }
    }
    return user.info
  }
  /**
   * 更新用户info属性下的子对象或属性
   * @param {number} uid - 用户ID
   * @param {Object} infoUpdates - 要更新的info子属性
   * @returns {Promise<Object>} 更新后的用户信息
   */
  async updateUserInfo(uid, infoUpdates) {
    if (!infoUpdates || typeof infoUpdates !== 'object') {
      throw new Error('info更新数据必须是对象');
    }

    // 获取当前用户信息
    const user = await this.getUser({ uid });
    if (!user) {
      return { code: 100, err: "no-user" }
    }

    // 解析当前的info字段
    let currentInfo = {};
    try {
      currentInfo = typeof user.info === 'string' ? JSON.parse(user.info) : (user.info || {});
    } catch (error) {
      this.gl.logger.warn('解析用户info字段失败，使用空对象', { uid, error: error.message });
      currentInfo = {};
    }

    // 合并更新的info属性
    const updatedInfo = { ...currentInfo, ...infoUpdates };

    // 更新用户info字段
    const updatedUser = await this.gl.db.update('users',
      { info: JSON.stringify(updatedInfo) },
      { uid }
    );

    if (!updatedUser) {
      return { code: 100, err: "update-info-failed" }
    }

    this.gl.logger.info('用户info更新成功', {
      uid,
      updatedFields: Object.keys(infoUpdates)
    });

    // 返回用户信息（不包含密码）
    const { pass, ...userInfo } = updatedUser;
    return { code: 0, info: userInfo };
  }

  /**
   * 更新用户密码
   * @param {number} uid - 用户ID
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码
   * @returns {Promise<boolean>} 是否更新成功
   */
  async updatePassword(uid, oldPassword, newPassword) {
    if (!oldPassword || !newPassword) {
      throw new Error('旧密码和新密码不能为空');
    }

    // 获取用户当前密码
    const user = await this.gl.db.findOne(
      'SELECT pass FROM users WHERE uid = $1',
      [uid]
    );

    if (!user) {
      throw new Error('用户不存在');
    }

    // 验证旧密码
    const isValidOldPassword = this.verifyPassword(oldPassword, user.pass);

    if (!isValidOldPassword) {
      throw new Error('旧密码错误');
    }

    // 加密新密码
    const { hash } = this.hashPassword(newPassword);

    // 更新密码
    await this.gl.db.update('users', { pass: hash }, { uid });

    this.gl.logger.info('用户密码更新成功', { uid });

    return true;
  }

  /**
   * 删除用户（软删除，设置status为0）
   * @param {number} uid - 用户ID
   * @returns {Promise<boolean>} 是否删除成功
   */
  async deleteUser(uid) {
    const result = await this.gl.db.update('users', { status: 0 }, { uid });

    if (!result) {
      throw new Error('用户不存在');
    }

    this.gl.logger.info('用户删除成功', { uid });

    return true;
  }

  /**
   * 获取用户等级
   * @param {number} uid - 用户ID
   * @returns {Promise<number>} 用户等级，如果level_exp已过期则返回0
   */
  async getUserLevel(uid) {
    if (!uid) {
      throw new Error('用户ID不能为空');
    }

    // 查询用户的level和level_exp字段
    const user = await this.gl.db.findOne(
      'SELECT level, level_exp FROM users WHERE uid = $1',
      [uid]
    );

    if (!user) {
      throw new Error('用户不存在');
    }
    // 如果没有level字段或level_exp字段，返回0
    if (!user.level || !user.level_exp) {
      return 0;
    }

    // 检查level_exp是否小于当前时间
    const currentTime = new Date();
    const levelExpTime = new Date(user.level_exp);

    if (levelExpTime < currentTime) {
      // level_exp已过期，返回0
      return 0;
    }

    // level_exp未过期，返回level值
    return user.level || 0;
  }

  /**
   * 确保用户存在，如果不存在则创建用户
   * @param {Object} userData - 用户数据
   * @param {string} userData.email - 邮箱（可选，如果提供uid则可不提供）
   * @param {number} userData.uid - 用户ID（可选，如果提供email则可不提供）
   * @param {string} userData.frm - 第三方来源
   * @param {Object} userData.info - 用户信息（可选）
   * @returns {Promise<Object>} 用户信息
   */
  async ensureUser({ email, uid, frm, info = {} }) {
    // 参数验证
    if (!email && !uid) {
      throw new Error('必须提供邮箱或用户ID');
    }

    let user = null;

    // 根据提供的参数查找用户
    user = await this.getUser({ email, uid });

    // 如果用户存在，返回用户信息
    if (user) {
      this.gl.logger.info('用户已存在', {
        uid: user.uid,
        email: user.email,
        frm: user.frm
      });
      return user;
    }

    // 如果用户不存在，创建新用户
    if (!email) {
      throw new Error('创建用户时邮箱不能为空');
    }

    // 如果是第三方用户且没有密码，会自动生成随机密码
    const newUser = await this.createUser({ email, frm: frm || 0, info });

    this.gl.logger.info('用户创建成功', { uid: newUser.uid, email: newUser.email, frm: newUser.frm, fromName: this.getFromName(newUser.frm) });

    return newUser;
  }


  async handleLoginSuccessful_fromCommonAPI({ OTT, ...rest }) {
    const { redis } = this.gl
    console.log("handleLoginSuccessful_fromCommonAPI", OTT, rest)
    if (!OTT) return { code: 100, err: "no-ott" }
    const { type, email, picture, avatar_url } = rest
    if (type === 'google') {
      await this.ensureUser({ email, frm: 1, info: { avatar: picture } })
    }
    if (type === 'maxthon') {
      if (!email) email = 'non-exist@non-exist.ooo'
      await this.ensureUser({ email, frm: 2, info: { avatar: avatar_url } })
    }
    if (type === 'email') {
      await this.ensureUser({ email, frm: 3, info: {} })
    }
    redis.$r.set(OTT, email, 'EX', 60 * 5)
    return { msg: "ok" }
  }
  async handleOrderPaid_fromCommonAPI(meta) {
    const { db } = this.gl
    const { uid, type, name, endTime, amount, id: order_id, pid, email, lang = 'en' } = meta
    try {
      await db.insert('payments', { uid, type, amount, order_id, meta })
    } catch (err) { }
    if (!uid) return { err: "no-uid" }
    //handle subscription
    const userinfo = await this.getUserInfo({ uid })
    let delta = 0
    if (userinfo?.pay) {
      const { amount: oldAmount = 0, endTime = 0, name: oldName = '' } = userinfo?.pay
      const newName = meta?.name || ''
      let { amount: newAmount = 0 } = meta
      if (newAmount === 0) {
        newAmount = +(meta.price?.split('|')[0]) || 0
      }

      // 当前剩余秒数（endTime 为旧周期的结束时间）
      const remainingSec = Math.max(0, (endTime * 1000 - Date.now()) / 1000)

      // 推断周期秒数：优先用名称包含的 Monthly/Yearly，其次用价格标签 |M |Y
      const monthSec = 30 * 24 * 60 * 60
      const yearSec = 365 * 24 * 60 * 60
      const inferCycleSec = (nameStr, priceTag) => {
        const lower = (nameStr || '').toLowerCase()
        if (lower.includes('year')) return yearSec
        if (lower.includes('month')) return monthSec
        const tag = (priceTag || '').split('|')[1]?.trim()?.toLowerCase()
        if (tag === 'y') return yearSec
        if (tag === 'm') return monthSec
        return monthSec
      }
      const oldCycleSec = inferCycleSec(oldName)
      const newCycleSec = inferCycleSec(newName, meta?.price)

      // 将剩余服务价值按新价格（每秒单价）换算成时间（秒）
      if (remainingSec > 0 && oldAmount > 0 && newAmount > 0) {
        const oldRatePerSec = oldAmount / oldCycleSec
        const newRatePerSec = newAmount / newCycleSec
        delta = Math.floor(remainingSec * (oldRatePerSec / newRatePerSec))
      } else {
        delta = 0
      }
      console.log("plan-change-delta:", delta)
    }
    return await this.updateUserInfo(uid, { pay: meta, delta })
  }

  async getPlan({ user, uid }) {
    if (!user) user = await this.getUser({ uid })
    if (!user?.info?.pay) return { name: 'free' }
    let { name, endTime } = user?.info?.pay
    if (endTime * 1000 < Date.now()) return { name: 'free' }
    const delta = +user?.info?.delta || 0
    if (!name) name = user?.info?.pay.product
    name = name.toLowerCase()
    if (name.indexOf('basic') > -1) {
      return { name: 'basic', endTime: endTime + delta }
    }
    if (name.indexOf('pro') > -1) {
      return { name: 'pro', endTime: endTime + delta }
    }
    if (name.indexOf('basic') > -1) {
      return { name: 'basic', endTime: endTime + delta }
    }
    if (name.indexOf('plus') > -1) {
      return { name: 'plus', endTime: endTime + delta }
    }
    if (name.indexOf('ultra') > -1) {
      return { name: 'ultra', endTime: endTime + delta }
    }

    return { name: 'free' }
  }


  /**
   * 注册用户管理相关的API端点
   * @param {Object} app - Fastify应用实例
   */
  async regEndpoints(app) {
    // 用户注册
    app.post('/user/register', async (req, res) => {
      try {
        const { email, password, frm, info } = req.body;
        const user = await this.createUser({ email, password, frm, info });

        return { result: user };
      } catch (error) {
        this.gl.logger.error('用户注册失败', { error: error.message, body: req.body });
        return { err: 'internal-server-error' };
      }
    });

    // 用户登录
    app.post('/user/login', async (req, res) => {
      try {
        const { util } = this.gl
        const { OTT, email, password } = req.body;
        const user = OTT ? await this.handleOTT({ OTT, uid: req.uid }) : await this.authenticateUser({ email, password });

        if (!user) {
          return { err: 'invalid-email-or-password' };
        }
        const token = await util.uidToToken({ uid: user.uid, create: Date.now(), expire: Date.now() + 1000 * 3600 * 24 * 30 })
        util.setCookie({ req, res, name: `${this.pname}_ut`, value: token, days: 30, secure: true })

        return { result: user };
      } catch (error) {
        this.gl.logger.error('用户登录失败', { error: error.message });
        return { err: 'internal-server-error' };
      }
    });
    app.get('/user/verifyCode', async (req, res) => {
      const { util, mail } = this.gl
      const { email, code } = req.query
      const result = await mail.verifyEmailCode({ email, code })
      if (result.code === 0) {
        const user = await this.ensureUser({ email, frm: 3 })
        const token = await util.uidToToken({ uid: user.uid, create: Date.now(), expire: Date.now() + 3600 * 24 * 30 })
        util.setCookie({ req, res, name: `${process.env.APP_NAME}_ut`, value: token, days: 30, secure: true })
        return { result: user };
      }
      return { err: 'invalid-code' }
    })
    // 获取用户信息
    app.get('/user/info', async (req, res) => {
      try {
        const uid = req.uid;
        if (!uid) {
          return { err: 'user-not-login' };
        }
        const { storage } = req.query
        const user = await this.getUser({ uid });
        user.plan = await this.getPlan({ user })
        if (storage) {
          user.storage = await this.getStorage({ uid })
        }
        return user ? { result: user } : { err: 'user-not-found' };
      } catch (error) {
        this.gl.logger.error('获取用户信息失败', { error: error.message, uid: req.uid });
        return { err: 'internal-server-error' };
      }
    });

    // 更新用户信息
    app.post('/user/update', async (req, res) => {
      try {
        const uid = req.uid;
        if (!uid) {
          return { err: 'user-not-login' };
        }

        const updateData = req.body;
        const user = await this.updateUser(uid, updateData);

        return { result: user };
      } catch (error) {
        this.gl.logger.error('更新用户信息失败', { error: error.message, uid: req.uid });
        return { err: 'internal-server-error' };
      }
    });

    // 更新用户密码
    app.post('/user/password', async (req, res) => {
      try {
        const uid = req.uid;
        if (!uid) {
          return { err: 'user-not-login' };
        }

        const { oldPassword, newPassword } = req.body;
        await this.updatePassword(uid, oldPassword, newPassword);

        return { result: '密码更新成功' };
      } catch (error) {
        this.gl.logger.error('更新密码失败', { error: error.message, uid: req.uid });
        return { err: 'internal-server-error' };
      }
    });

    // 更新用户info属性
    app.post('/user/info/update', async (req, res) => {
      try {
        const uid = req.uid;
        if (!uid) {
          return { err: 'user-not-login' };
        }

        const infoUpdates = req.body;
        const user = await this.updateUserInfo(uid, infoUpdates);

        return { result: user };
      } catch (error) {
        this.gl.logger.error('更新用户info失败', { error: error.message, uid: req.uid });
        return { err: 'internal-server-error' };
      }
    });

    // 删除用户
    app.delete('/user/delete', async (req, res) => {
      try {
        const uid = req.uid;
        if (!uid) {
          return { err: 'user-not-login' };
        }
        await this.deleteUser(uid);

        return { result: '用户删除成功' };
      } catch (error) {
        this.gl.logger.error('删除用户失败', { error: error.message, uid: req.uid });
        return { err: 'internal-server-error' };
      }
    });


    // 获取其他用户信息（邮箱和头像）
    app.get('/user/otherUserInfo', async (req, res) => {
      try {
        const { uids } = req.query;
        if (!uids) {
          return { err: 'missing-uids-parameter' };
        }

        const { db } = this.gl;

        // 解析用户ID字符串，支持逗号分隔的多个ID
        const userIds = uids.toString().split(',').map(uid => uid.trim()).filter(uid => uid);

        if (userIds.length === 0) {
          return { err: 'invalid-uids-parameter' };
        }

        // 查询用户信息（只返回邮箱和头像）
        const placeholders = userIds.map((_, index) => `$${index + 1}`).join(',');
        const query = `
          SELECT uid, email, info->>'avatar' as avatar
          FROM users 
          WHERE uid IN (${placeholders})
        `;

        const result = await db.query(query, userIds);

        // 构建结果对象，以uid为key
        const userInfoMap = {};
        result.rows.forEach(row => {
          userInfoMap[row.uid] = {
            email: row.email,
            avatar: row.avatar || null
          };
        });

        return { result: userInfoMap };
      } catch (error) {
        this.gl.logger.error('获取其他用户信息失败', { error: error.message, query: req.query });
        return { err: 'internal-server-error' };
      }
    });

  }
}