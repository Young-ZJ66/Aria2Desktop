/**
 * RPC secret 的密文保留前缀（主进程与渲染层**共用同一份**）。
 *
 * 为什么必须共享：主进程用它区分"密文 / 旧明文"（见 electron/utils/secretCipher.ts），
 * 渲染层用它做输入校验（用户不能把密钥设成以此开头，否则会被幂等护栏原样存储、
 * 再被解密器当密文解不出来而清空）。此前两处校验各写一份 `/^v1:/` 正则，
 * 前缀一变就会静默失配——收敛到本文件后只有一处事实来源。
 */
export const SECRET_CIPHER_PREFIX = 'v1:'

/** 用户输入是否使用了保留前缀（表单校验用） */
export function isReservedSecretPrefix(value: string): boolean {
  return value.startsWith(SECRET_CIPHER_PREFIX)
}
