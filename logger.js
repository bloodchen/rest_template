import pino from 'pino';
import { createConsola } from 'consola';
import fs from 'fs';
import path from 'path';

export class Logger {
    constructor(options = {}) {
        this.logDir = options.logDir || './logs';
        this.serviceName = options.serviceName || 'app';

        // 确保日志目录存在
        this.ensureLogDir();
        this.logger = this.createLogger();

    }

    /**
     * 确保日志目录存在
     */
    ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * 获取当前日期字符串 (YYYY-MM-DD)
     */
    getCurrentDateString() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * 获取错误日志文件路径
     */
    getErrorLogPath() {
        const dateStr = this.getCurrentDateString();
        return path.join(this.logDir, `${this.serviceName}-error-${dateStr}.log`);
    }

    /**
     * 创建pino logger实例
     */
    createLogger() {
        const isDevelopment = process.env.NODE_ENV !== 'production';
        if (isDevelopment) {
            return createConsola({
                // 这一行是关键：强制让 consola 调用 console.log/error 等原生方法
                // 这样 VS Code 的 Debug Console (internalConsole) 就能 100% 捕获，且带有颜色
                reporters: [
                    {
                        log: (logObj) => {
                            const { type, args } = logObj;
                            // 映射 consola 的 type 到 console 的方法
                            const consoleMethod = console[type] || console.log;
                            // 甚至可以加上简单的颜色处理，或者直接输出
                            consoleMethod(...args);
                        },
                    },
                ],
            });
        }
        // 创建pino实例
        const baseConfig = {
            name: this.serviceName,
            level: process.env.LOG_LEVEL || 'info',
            timestamp: pino.stdTimeFunctions.isoTime,
            formatters: {
                level: (label) => {
                    return { level: label };
                }
            }
        };

        // 开发环境配置
        if (isDevelopment) {
            return pino(
                {
                    ...baseConfig,
                    transport: {
                        level: 'debug',
                        target: 'pino-pretty',
                        options: {
                            colorize: true,
                            singleLine: false,
                            translateTime: 'yyyy-mm-dd HH:MM:ss',
                            ignore: 'pid,hostname'
                        }
                    }
                } // <-- 输出到 stderr（VS Code Debug Console 能看到）
            );
        }

        // 生产环境配置
        return pino(baseConfig);
    }

    /**
     * 写入错误日志到文件
     */
    writeErrorToFile(level, message, extra = {}) {
        const errorLogPath = this.getErrorLogPath();
        const logEntry = { timestamp: new Date().toISOString(), level, service: this.serviceName, message, ...extra };

        const logLine = JSON.stringify(logEntry) + '\n';

        try {
            fs.appendFileSync(errorLogPath, logLine);
        } catch (err) {
            console.error('Failed to write error log to file:', err);
        }
    }

    /**
     * Info级别日志
     */
    info(...args) {
        this.logger.info(...args);
    }

    /**
     * Debug级别日志
     */
    debug(...args) {
        this.logger.debug(...args);
    }

    /**
     * Warn级别日志
     */
    warn(...args) {
        this.logger.warn(...args);
        // 警告级别也写入错误文件
        this.writeErrorToFile('warn', ...args);
    }

    /**
     * Error级别日志
     */
    error(...args) {
        this.logger.error(...args);
        // 错误日志写入文件
        this.writeErrorToFile('error', ...args);
    }

    /**
     * Fatal级别日志
     */
    fatal(...args) {
        this.logger.fatal(...args);
        // 致命错误也写入文件
        this.writeErrorToFile('fatal', ...args);
    }

    /**
     * 记录HTTP请求日志
     */
    logRequest(req, res, responseTime) {
        const logData = { method: req.method, url: req.url, statusCode: res.statusCode, responseTime: `${responseTime}ms`, userAgent: req.headers['user-agent'], ip: req.ip || req.connection.remoteAddress };

        if (res.statusCode >= 400) {
            this.error('HTTP Request Error', logData);
        } else {
            this.info('HTTP Request', logData);
        }
    }

    /**
     * 获取子logger（带有额外的上下文信息）
     */
    child(bindings) {
        const childLogger = this.logger.child(bindings);

        return {
            info: (message, extra = {}) => childLogger.info(extra, message),
            debug: (message, extra = {}) => childLogger.debug(extra, message),
            warn: (message, extra = {}) => {
                childLogger.warn(extra, message);
                this.writeErrorToFile('warn', message, { ...bindings, ...extra });
            },
            error: (message, extra = {}) => {
                childLogger.error(extra, message);
                this.writeErrorToFile('error', message, { ...bindings, ...extra });
            },
            fatal: (message, extra = {}) => {
                childLogger.fatal(extra, message);
                this.writeErrorToFile('fatal', message, { ...bindings, ...extra });
            }
        };
    }
}