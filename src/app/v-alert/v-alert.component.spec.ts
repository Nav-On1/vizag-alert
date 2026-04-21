import { ComponentFixture, TestBed } from '@angular/core/testing';

import { VAlertComponent } from './v-alert.component';

describe('VAlertComponent', () => {
  let component: VAlertComponent;
  let fixture: ComponentFixture<VAlertComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VAlertComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(VAlertComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
