import { Processor, WorkerHost } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@/infra/queue/queue.constants';
import { ShiftsService } from '@/modules/shifts/shifts.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';

@Processor(QUEUE_NAMES.shiftForgotten, { concurrency: 1 })
export class ShiftForgottenProcessor extends WorkerHost {
  constructor(
    private readonly shifts: ShiftsService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(): Promise<void> {
    const forgotten = await this.shifts.findForgottenShifts();
    for (const shift of forgotten) {
      const hoursOpen = Math.floor((Date.now() - shift.openedAt.getTime()) / 3_600_000);
      await this.notifications.enqueue('staff.shift_forgotten', {
        shiftId: shift.id,
        stationId: shift.stationId,
        hoursOpen,
      });
    }
  }
}
