// Invite Code System for Viral Growth
// Generates, validates, and tracks invite codes

import crypto from 'crypto';

export interface InviteCode {
  code: string;
  createdBy: string;
  createdAt: number;
  usageCount: number;
  maxUses: number;
  discountPercent: number;
  referralBonusPoints: number;
  isActive: boolean;
  expiresAt?: number;
}

export class InviteCodeManager {
  private codes: Map<string, InviteCode> = new Map();
  
  // Generate a beautiful, shareable invite code (e.g., "COOKIE-ABC123-XYZ789")
  generateCode(
    createdBy: string,
    maxUses: number = 10,
    discountPercent: number = 10,
    referralBonusPoints: number = 50,
    expiresInDays?: number
  ): string {
    const randomPart = crypto.randomBytes(9).toString('hex').toUpperCase();
    const codePrefix = 'COOKIE';
    const codeParts = randomPart.match(/.{1,6}/g) || [];
    const code = `${codePrefix}-${codeParts.join('-')}`;

    const inviteCode: InviteCode = {
      code,
      createdBy,
      createdAt: Date.now(),
      usageCount: 0,
      maxUses,
      discountPercent,
      referralBonusPoints,
      isActive: true,
      expiresAt: expiresInDays ? Date.now() + expiresInDays * 24 * 60 * 60 * 1000 : undefined,
    };

    this.codes.set(code, inviteCode);
    return code;
  }

  // Validate invite code before use
  validateCode(code: string): { valid: boolean; error?: string; code?: InviteCode } {
    const inviteCode = this.codes.get(code);

    if (!inviteCode) {
      return { valid: false, error: 'Invalid invite code' };
    }

    if (!inviteCode.isActive) {
      return { valid: false, error: 'This invite code has been deactivated' };
    }

    if (inviteCode.usageCount >= inviteCode.maxUses) {
      return { valid: false, error: 'This invite code has reached its usage limit' };
    }

    if (inviteCode.expiresAt && Date.now() > inviteCode.expiresAt) {
      inviteCode.isActive = false;
      return { valid: false, error: 'This invite code has expired' };
    }

    return { valid: true, code: inviteCode };
  }

  // Use (consume) an invite code
  useCode(code: string): { success: boolean; bonus?: number; discount?: number; error?: string } {
    const validation = this.validateCode(code);

    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const inviteCode = validation.code!;
    inviteCode.usageCount += 1;

    // Deactivate if max uses reached
    if (inviteCode.usageCount >= inviteCode.maxUses) {
      inviteCode.isActive = false;
    }

    return {
      success: true,
      bonus: inviteCode.referralBonusPoints,
      discount: inviteCode.discountPercent,
    };
  }

  // Get code stats
  getCodeStats(code: string): InviteCode | null {
    return this.codes.get(code) || null;
  }

  // List all codes (for admin)
  getAllCodes(): InviteCode[] {
    return Array.from(this.codes.values());
  }

  // Bulk generate codes for campaigns
  generateBatch(
    createdBy: string,
    count: number,
    maxUses: number = 5,
    discountPercent: number = 10,
    referralBonusPoints: number = 50
  ): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      codes.push(
        this.generateCode(createdBy, maxUses, discountPercent, referralBonusPoints)
      );
    }
    return codes;
  }
}

// Export singleton instance
export const inviteCodeManager = new InviteCodeManager();

// Pre-load some example codes for testing
inviteCodeManager.generateCode('admin', 100, 15, 100); // COOKIE-ABC123
inviteCodeManager.generateCode('influencer', 50, 20, 150); // Higher reward
inviteCodeManager.generateCode('early-access', 1000, 5, 25); // Cheap but high volume
