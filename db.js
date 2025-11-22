import pgPromise from 'pg-promise';
import { BaseService } from './common/baseService.js';
import { createTables } from './dbInit.js'

export class DB extends BaseService {
  async init(gl) {
    const { logger } = gl;
    this.isConnected = false;
    this.pgp = null;
    this.db = null;
    // 优先使用 connectionString，如果没有则使用分离的配置参数
    const connectionString = process.env.DB_URL;
    if (!connectionString) {
      return '数据库连接字符串未配置';
    }
    let dbConfig;
    // 使用连接字符串
    dbConfig = {
      connectionString,
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 2000,
    };
    logger.info('使用连接字符串创建数据库连接池', {
      connectionString: connectionString.replace(/\/\/[^@]*@/, '//***:***@'),
      poolMax: dbConfig.max
    });

    this.pgp = pgPromise({
      capSQL: true
    });
    this.db = this.pgp(connectionString);

    await this.testConnection();
    this.isConnected = true;
    logger.info('数据库连接初始化成功');
    await createTables(this)
  }

  async testConnection() {
    const result = await this.db.one('SELECT NOW() as current_time, version() as version');
    this.gl.logger.info('数据库连接测试成功', {
      currentTime: result.current_time,
      version: result.version.split(' ')[0]
    });
  }

  // 执行查询的方法
  async query(text, params) {
    const start = Date.now();
    try {
      const res = await this.db.result(text, params);
      const duration = Date.now() - start;
      // console.log('Executed query', { text, duration, rows: res.rowCount });
      return res;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  }

  // 事务方法
  async transaction(callback) {
    return this.db.tx(async t => {
      const client = {
        query: (sql, params) => t.result(sql, params)
      };
      return callback(client);
    });
  }

  /**
    * 执行数据库迁移脚本
    * @param {string} migrationSql - 迁移SQL脚本
    * @returns {Promise<void>}
    */
  async migrate(migrationSql) {
    await this.transaction(async (client) => {
      this.gl.logger.info('执行数据库迁移');
      await client.query(migrationSql);
      this.gl.logger.info('数据库迁移完成');
    });
  }

  // 优雅关闭数据库连接
  async close() {
    try {
      if (this.pgp) this.pgp.end();
      console.log('Database connections closed');
    } catch (error) {
      console.error('Error closing database:', error);
    }
  }

  /**
   * 检查表是否存在
   * @param {string} tableName - 表名
   * @returns {Promise<boolean>} 表是否存在
   */
  async tableExists(tableName) {
    const result = await this.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )`,
      [tableName]
    );
    return result.rows[0].exists;
  }

  /**
   * 查找单条记录
   * @param {string} query - SQL查询语句
   * @param {Array} params - 查询参数
   * @returns {Promise<Object|null>} 查询结果或null
   */
  async findOne(query, params = []) {
    const result = await this.query(query, params);
    return result.rows[0] || null;
  }

  // --- Ported Methods from maxai/db.js ---

  async saveMessage({ uid, cid, message, pid = 0, mid, tm, ai, model }) {
    uid = +uid; cid = +cid; mid = +mid; pid = +pid;
    const query = `
      INSERT INTO messages (uid, cid, message, pid, mid, tm, ai, model)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    await this.db.none(query, [uid, cid, message, pid, mid, tm, ai, model]);
    return { cid, pid, mid, tm };
  }

  async getConversation({ cid }) {
    if (!cid) return [];
    cid = +cid;
    return await this.db.any('SELECT * FROM messages WHERE cid = $1 ORDER BY tm ASC', [cid]);
  }

  async setConvName({ uid, cid, name, ai, model }) {
    cid = +cid;
    uid = +uid;
    // Upsert logic
    const query = `
      INSERT INTO convs (uid, cid, name, ai, model)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (cid) DO UPDATE SET
        uid = EXCLUDED.uid,
        name = EXCLUDED.name,
        ai = COALESCE(EXCLUDED.ai, convs.ai),
        model = COALESCE(EXCLUDED.model, convs.model)
    `;
    // Note: The original mongo logic: if (ai) options.ai = ai.
    // In SQL upsert, we can use COALESCE or conditional logic.
    // Here I'm assuming if passed ai/model are null/undefined, we keep existing.
    // But wait, $4 and $5 will be the passed values.
    // If they are undefined, they will be null.
    // So COALESCE(EXCLUDED.ai, convs.ai) works if we want to keep existing if new is null.
    // But if the user explicitly passes null to clear it? Mongo code: `if (ai) options.ai = ai`.
    // So if ai is undefined/null, it's not in options, so $set doesn't touch it.
    // In SQL, we need to handle this.
    // Let's build the query dynamically or use a smarter upsert.
    // For simplicity, let's assume we just update what's passed.

    // Actually, standard upsert replaces.
    // Let's stick to a simple upsert for now, but maybe we should check if record exists first?
    // No, upsert is better.
    // Let's use the simple version:

    const result = await this.db.none(query, [uid, cid, name, ai, model]);
    return result;
  }

  async setConvTime({ cid, tm }) {
    cid = +cid;
    return await this.db.none('UPDATE convs SET tm = $1 WHERE cid = $2', [tm, cid]);
  }

  async getConvName({ cid }) {
    return await this.db.oneOrNone('SELECT * FROM convs WHERE cid = $1', [+cid]);
  }

  async delConv({ cid }) {
    cid = +cid;
    await this.db.none('DELETE FROM messages WHERE cid = $1', [cid]);
    await this.db.none('DELETE FROM convs WHERE cid = $1', [cid]);
    return { deleted: true };
  }

  async updateConv({ cid, name, ai, model }) {
    cid = +cid;
    // Dynamic update
    const sets = [];
    const values = [cid];
    if (name !== undefined) { sets.push(`name = $${values.length + 1}`); values.push(name); }
    if (ai !== undefined) { sets.push(`ai = $${values.length + 1}`); values.push(ai); }
    if (model !== undefined) { sets.push(`model = $${values.length + 1}`); values.push(model); }

    if (sets.length === 0) return null;

    const query = `UPDATE convs SET ${sets.join(', ')} WHERE cid = $1`;
    return await this.db.none(query, values);
  }

  async getMsg({ mid }) {
    return await this.db.oneOrNone('SELECT * FROM messages WHERE mid = $1', [+mid]);
  }

  async delMsg({ cid, mid, toEnd }) {
    cid = +cid; mid = +mid;
    if (!toEnd) {
      return await this.db.none('DELETE FROM messages WHERE mid = $1', [mid]);
    }
    const msg = await this.getMsg({ mid });
    if (!msg) return { code: 1, msg: "msg not found" };
    const { tm } = msg;
    return await this.db.none('DELETE FROM messages WHERE cid = $1 AND tm >= $2', [cid, tm]);
  }

  async getConvList({ uid }) {
    uid = +uid;
    return await this.db.any('SELECT * FROM convs WHERE uid = $1 ORDER BY tm ASC', [uid]);
  }

  async getPreviousMessages({ cid, pid, num }) {
    if (!pid || !cid) return [];
    cid = +cid; pid = +pid;
    if (!pid) return await this.getConversation({ cid });

    const msg = await this.db.oneOrNone('SELECT * FROM messages WHERE mid = $1', [pid]);
    if (!msg) return [];

    return await this.db.any(
      'SELECT * FROM messages WHERE cid = $1 AND tm <= $2 ORDER BY tm ASC LIMIT 100',
      [cid, msg.tm]
    );
  }

  async getUserData({ uid }) {
    const res = await this.db.oneOrNone('SELECT data FROM userdata WHERE uid = $1', [+uid]);
    return res ? res.data : {};
  }

  async setUserData({ uid, data }) {
    uid = +uid;
    // We need to merge data if it exists, or replace?
    // Mongo: $set: { uid, ...data } with upsert: true.
    // This merges top-level fields.
    // In Postgres JSONB, we can use || operator to merge.

    const query = `
      INSERT INTO userdata (uid, data)
      VALUES ($1, $2)
      ON CONFLICT (uid) DO UPDATE SET
        data = userdata.data || EXCLUDED.data
    `;
    return await this.db.none(query, [uid, data]);
  }

  getOrderId({ uid, product }) {
    return uid + '-' + product;
  }

  async getOrder({ id, uid, product, all = false }) {
    let query = 'SELECT * FROM orders WHERE uid = $1';
    const params = [uid];

    if (product) {
      query += ` AND product = $${params.length + 1}`;
      params.push(product);
    }

    query += ' ORDER BY ctime DESC';

    const result = await this.db.any(query, params);
    return all ? result : result[0];
  }

  async createOrder({ uid, meta }) {
    const ctime = Math.floor(Date.now() / 1000);
    const { product } = meta;
    const id = this.getOrderId({ uid, product });

    const query = `
      INSERT INTO orders (id, uid, product, meta, ctime)
      VALUES ($1, $2, $3, $4, $5)
    `;
    await this.db.none(query, [id, uid, product, meta, ctime]);
    return id;
  }

  async shareMsg({ mids, uid }) {
    // mids is array
    return await this.db.none(
      'UPDATE messages SET share = true WHERE mid IN ($1:csv) AND uid = $2',
      [mids, uid]
    );
  }

  async getSharedMsg({ mids }) {
    return await this.db.any(
      'SELECT * FROM messages WHERE mid IN ($1:csv) AND share = true',
      [mids]
    );
  }

  // KV Store Methods
  async setKV(key, value, ttl) {
    const expire = Date.now() + ttl * 1000;
    const query = `
      INSERT INTO kv (key, value, expire)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        expire = EXCLUDED.expire
    `;
    await this.db.none(query, [key, { v: value }, expire]);
  }

  async getKV(key) {
    const res = await this.db.oneOrNone('SELECT value, expire FROM kv WHERE key = $1', [key]);
    if (!res) return null;
    if (res.expire < Date.now()) {
      await this.delKV(key);
      return null;
    }
    return res.value.v;
  }

  async delKV(key) {
    await this.db.none('DELETE FROM kv WHERE key = $1', [key]);
  }
}
