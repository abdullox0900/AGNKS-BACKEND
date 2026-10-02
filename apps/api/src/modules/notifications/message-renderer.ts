import type { OutboxKind } from './notifications.service';
import { formatMoney } from '@/common/lib/format-money';

export function renderMessage(kind: OutboxKind, payload: Record<string, unknown>): string {
  switch (kind) {
    case 'client.receipt_applied':
      return `✅ Balansingizga ${formatMoney(payload.bonus)} bonus tushdi.`;
    case 'client.receipt_pending':
      return `⏳ Chekingiz tekshiruvda. Natija haqida xabar beramiz.`;
    case 'client.receipt_rejected':
      return `❌ Chekingiz rad etildi.${payload.note ? ` Sabab: ${payload.note}` : ''}`;
    case 'client.spend_applied':
      return `💳 ${formatMoney(payload.amount)} bonus yechildi. Qolgan balans: ${formatMoney(payload.balanceAfter)}.`;
    case 'client.dispute_resolved':
      return `📩 Shikoyatingiz ko'rib chiqildi: ${resolutionText(payload.resolution)}.`;
    case 'client.bonus_expiry_warning':
      return `⚠️ ${formatMoney(payload.amount)} bonusingiz ${payload.days} kundan keyin kuyadi.`;
    case 'client.broadcast':
      return String(payload.text ?? '');
    case 'client.bonus_expired':
      return `🔥 Muddati o'tgani uchun bonus balansingiz kuydi.`;
    case 'staff.shift_flagged':
      return `🚩 Smena diqqat talab qiladi: ${payload.shiftId ?? ''}. ${payload.note ?? ''}`;
    case 'staff.shift_forgotten':
      return `⏰ Kassir smenani yopishni unutgan bo'lishi mumkin (${payload.hoursOpen ?? '?'} soatdan beri ochiq).`;
    case 'staff.anomaly':
      return `🔎 Anomaliya aniqlandi: ${payload.reason ?? 'unknown'}.`;
    case 'staff.daily_report':
      return `📊 Kunlik hisobot tayyor.`;
    case 'staff.cashier_daily':
      return `📊 Siz bugun ${payload.count} ta operatsiyada jami ${formatMoney(payload.amount)} bonus yechib berdingiz.`;
    default:
      return 'Bildirishnoma';
  }
}

function resolutionText(resolution: unknown): string {
  if (resolution === 'upheld') return 'operatsiya to\'g\'ri';
  if (resolution === 'reversed') return 'to\'liq qaytarildi';
  if (resolution === 'adjusted') return 'farq qaytarildi';
  return String(resolution);
}
