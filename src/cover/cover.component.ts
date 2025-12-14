import { Component, ChangeDetectionStrategy, output } from '@angular/core';

@Component({
  selector: 'app-cover',
  standalone: true,
  templateUrl: './cover.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoverComponent {
  open = output<void>();
  discover = output<void>();
  close = output<void>();

  onOpen(): void {
    this.open.emit();
  }
  
  onDiscover(): void {
    this.discover.emit();
  }

  onClose(): void {
    this.close.emit();
  }
}