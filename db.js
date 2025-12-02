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
