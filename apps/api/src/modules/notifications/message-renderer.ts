import type { OutboxKind } from './notifications.service';
import { formatMoney, type MessageLang } from '@/common/lib/format-money';

/** Free-form broadcasts go out as written (plain text); everything else is HTML with a bold title. */
export function isHtmlMessage(kind: OutboxKind): boolean {
  return kind !== 'client.broadcast';
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A bold title line, then the body lines — one layout for every notification. */
const card = (title: string, ...lines: (string | null | undefined | false)[]) => [`<b>${title}</b>`, ...lines.filter(Boolean)].join('\n');

/**
 * Text of one notification in the recipient's language. Titles carry an emoji so the chat list and the
 * message itself read at a glance; amounts are bold.
 */
export function renderMessage(kind: OutboxKind, payload: Record<string, unknown>, lang: MessageLang = 'uz'): string {
  const ru = lang === 'ru';
  const money = (v: unknown) => formatMoney(v, lang);
  const balance = (v: unknown) => (v === undefined || v === null ? null : `💰 ${ru ? 'Баланс' : 'Balans'}: <b>${money(v)}</b>`);

  switch (kind) {
    case 'client.receipt_applied':
      return card(
        ru ? '✅ Бонус начислен' : '✅ Bonus tushdi',
        `${ru ? 'На ваш баланс зачислено' : "Balansingizga qo'shildi"}: <b>+${money(payload.bonus)}</b>`,
        balance(payload.balanceAfter),
      );
    case 'client.receipt_pending':
      return card(
        ru ? '⏳ Чек на проверке' : '⏳ Chek tekshiruvda',
        ru ? 'Сообщим, как только проверка завершится.' : "Tekshiruv tugagach sizga xabar beramiz.",
      );
    case 'client.receipt_rejected':
      return card(
        ru ? '❌ Чек отклонён' : '❌ Chek rad etildi',
        payload.note ? `${ru ? 'Причина' : 'Sabab'}: ${esc(payload.note)}` : null,
      );
    case 'client.spend_applied':
      return card(
        ru ? '💳 Бонус списан' : '💳 Bonus yechildi',
        `${ru ? 'Списано' : 'Yechildi'}: <b>−${money(payload.amount)}</b>`,
        balance(payload.balanceAfter),
      );
    case 'client.dispute_resolved':
      return card(ru ? '📩 Обращение рассмотрено' : "📩 Murojaatingiz ko'rib chiqildi", `${ru ? 'Итог' : 'Natija'}: ${resolutionText(payload.resolution, lang)}`);
    case 'client.bonus_expiry_warning':
      return card(
        ru ? '⏰ Бонусы скоро сгорят' : '⏰ Bonus muddati tugayapti',
        ru ? `<b>${money(payload.amount)}</b> сгорят через ${esc(payload.days)} дн. Успейте потратить!` : `<b>${money(payload.amount)}</b> bonusingiz ${esc(payload.days)} kundan keyin kuyadi. Ulgurib ishlating!`,
      );
    case 'client.bonus_expired':
      return card(ru ? '🔥 Срок бонусов истёк' : '🔥 Bonus muddati tugadi', ru ? 'Бонусы на балансе сгорели из-за истечения срока.' : "Muddati o'tgani uchun bonus balansingiz kuydi.");
    case 'client.broadcast':
      return String(payload.text ?? '');
    case 'staff.cashier_daily':
      return card('📊 Kunlik xulosa', `Siz bugun ${esc(payload.count)} ta operatsiyada jami <b>${money(payload.amount)}</b> bonus yechib berdingiz.`);
    case 'staff.shift_flagged':
    case 'staff.shift_forgotten':
    case 'staff.anomaly':
    case 'staff.daily_report':
      return 'Bildirishnoma';
    default:
      return ru ? 'Уведомление' : 'Bildirishnoma';
  }
}

function resolutionText(resolution: unknown, lang: MessageLang): string {
  const ru = lang === 'ru';
  if (resolution === 'upheld') return ru ? 'операция верна' : "operatsiya to'g'ri";
  if (resolution === 'reversed') return ru ? 'возвращено полностью' : "to'liq qaytarildi";
  if (resolution === 'adjusted') return ru ? 'разница возвращена' : 'farq qaytarildi';
  return esc(resolution);
}
