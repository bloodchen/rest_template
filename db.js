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

    // 定时任务，每6小时运行一次
    //cron.schedule('0 */6 * * *', () => {this.scanAndExpireFiles().catch(console.error);});
    // 首次运行时立即执行
    //this.scanAndExpireFiles();
    //this.deleteExpiredFilesFromB2();
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
      console.log('Executed query', { text, duration, rows: res.rowCount });
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

  /**
   * 插入记录
   * @param {string} tableName - 表名
   * @param {Object} data - 插入的数据
   * @returns {Promise<Object>} 插入的记录
   */
  async insert(tableName, data) {
    const fields = Object.keys(data);
    const values = Object.values(data);
    const placeholders = fields.map((_, index) => `$${index + 1}`).join(', ');

    const query = `INSERT INTO ${tableName} (${fields.join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const result = await this.query(query, values);
    return result.rows[0];
  }

  /**
   * 更新记录
   * @param {string} tableName - 表名
   * @param {Object} data - 更新的数据
   * @param {Object} where - 更新条件
   * @returns {Promise<Object|null>} 更新后的记录或null
   */
  async update(tableName, data, where) {
    const dataFields = Object.keys(data);
    const dataValues = Object.values(data);
    const whereFields = Object.keys(where);
    const whereValues = Object.values(where);

    const setClause = dataFields.map((field, index) => `${field} = $${index + 1}`).join(', ');
    const whereClause = whereFields.map((field, index) => `${field} = $${dataValues.length + index + 1}`).join(' AND ');

    const query = `UPDATE ${tableName} SET ${setClause} WHERE ${whereClause} RETURNING *`;
    const result = await this.query(query, [...dataValues, ...whereValues]);
    return result.rows[0] || null;
  }

  /**
   * 删除记录
   * @param {string} tableName - 表名
   * @param {Object} where - 删除条件
   * @returns {Promise<number>} 删除的记录数
   */
  async delete(tableName, where) {
    const whereFields = Object.keys(where);
    const whereValues = Object.values(where);
    const whereClause = whereFields.map((field, index) => `${field} = $${index + 1}`).join(' AND ');

    const query = `DELETE FROM ${tableName} WHERE ${whereClause}`;
    const result = await this.query(query, whereValues);
    return result.rowCount;
  }

}
