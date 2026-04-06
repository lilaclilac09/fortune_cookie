// 简单邀请码系统 - 至少10个码

export const INVITE_CODES = [
  { code: 'LUCKY001', bonus: 50 },
  { code: 'LUCKY002', bonus: 50 },
  { code: 'LUCKY003', bonus: 50 },
  { code: 'LUCKY004', bonus: 50 },
  { code: 'LUCKY005', bonus: 50 },
  { code: 'LUCKY006', bonus: 50 },
  { code: 'LUCKY007', bonus: 50 },
  { code: 'LUCKY008', bonus: 50 },
  { code: 'LUCKY009', bonus: 50 },
  { code: 'LUCKY010', bonus: 50 },
  { code: 'LUCKY888', bonus: 100 },  // 特殊码，奖励更高
];

export function validateCode(code: string): { valid: boolean; bonus: number } {
  const found = INVITE_CODES.find(c => c.code === code.toUpperCase());
  return {
    valid: !!found,
    bonus: found?.bonus || 0,
  };
}

export function getCodesList() {
  return INVITE_CODES.map(c => c.code);
}
