import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { VAlertComponent } from './v-alert/v-alert.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet,VAlertComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  template: '<app-v-alert></app-v-alert>'
})
export class AppComponent {
 // app.component.ts
title = 'angular-valert';
}
