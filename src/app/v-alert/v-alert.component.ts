import { Component, signal, computed, ViewChild, ElementRef, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { environment } from '../../environments/environment';

// --- Types & Enums ---
type ViewState = 'landing' | 'login' | 'dashboard' | 'departments' | 'capture' | 'success';
type UserRole = 'citizen' | 'admin' | 'superadmin';
type IssueStatus = 'Request' | 'Active' | 'Hold' | 'Resolved';

interface Department {
  id: number;
  name: string;
  icon: string;
  emergency: string;
  signalApiKey: string;
  whatsappApiKey?: string;
  desc: string;
}

interface User {
  id: string; // Firebase UID
  name: string;
  role: UserRole;
  deptId?: number; // Only for 'admin'
  govId: string;   // Stores Aadhaar, Emp ID, or SuperAdmin ID
  contactNumber?: string; // Contact Number for Officials
  designation?: string;   // Alert Handler, Inspector, etc.
}

interface Issue {
  id: string;
  firebaseId?: string; // Added to handle Firestore doc updates
  deptId: number;
  userId: string;
  desc: string;
  status: IssueStatus;
  timestamp: string;
  photoUrl: string;
}

interface AdminReq {
  id: string;
  deptId: number;
  type: 'Add Member' | 'Delete Member';
  targetName: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  requestedBy: string;
  timestamp: string;
}

@Component({
  selector: 'app-v-alert',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      <header class="bg-blue-900 text-white p-4 shadow-md sticky top-0 z-50 flex justify-between items-center">
        <div class="flex items-center gap-2 cursor-pointer" (click)="navigate('landing')">
          <span class="text-2xl">🚨</span>
          <h1 class="text-xl font-bold tracking-tight">VizagAlert</h1>
          @if (currentUser()) {
            <span class="text-[10px] bg-blue-700 px-2 py-0.5 rounded-full uppercase ml-2 border border-blue-500">
              {{ currentUser()?.role }}
            </span>
          }
        </div>
        @if (currentUser()) {
          <div class="flex items-center gap-3">
            @if (currentUser()?.role === 'admin') {
              <button (click)="enableNotifications()" class="text-xs bg-blue-800 text-white px-2 py-1 rounded hover:bg-blue-700">Test Sound</button>
            }
            <button (click)="logoutUser()" class="text-sm font-medium hover:text-red-300 transition">Logout</button>
          </div>
        } @else {
          <button (click)="openLogin('official')" class="text-sm font-medium hover:text-blue-200 transition">Official Login</button>
        }
      </header>

      <main class="max-w-md mx-auto p-4 mt-4">
        
        @if (currentView() === 'landing') {
          <div class="space-y-6 animate-fade-in">
            <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 text-center">
              <div class="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">📸</div>
              <h2 class="text-2xl font-bold mb-2">See an Issue? Report it.</h2>
              <p class="text-slate-600 mb-6 text-sm">Report civic issues directly to the correct department with live photo and GPS evidence.</p>
              <button (click)="startGuestReport()" class="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-4 rounded-xl shadow-md transition transform active:scale-95 text-lg">
                Report Issue (Guest)
              </button>
            </div>

            <div class="grid grid-cols-2 gap-4">
              <button (click)="openLogin('citizen')" class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-center hover:border-blue-300 transition active:scale-95">
                <span class="text-2xl block mb-2">👤</span>
                <span class="font-bold text-sm text-slate-800">Citizen Portal</span>
              </button>
              <button (click)="openLogin('official')" class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 text-center hover:border-blue-300 transition active:scale-95">
                <span class="text-2xl block mb-2">🏛️</span>
                <span class="font-bold text-sm text-slate-800">Official Login</span>
              </button>
            </div>
          </div>
        }

        @if (currentView() === 'login') {
          <div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 animate-fade-in">
            <h2 class="text-2xl font-bold mb-4">{{ loginType() === 'citizen' ? 'Citizen Portal' : 'Official Access' }}</h2>
            
            <div class="flex mb-6 bg-slate-100 p-1 rounded-lg">
              <button (click)="authMode.set('login'); authError.set('')" [class.bg-white]="authMode() === 'login'" [class.shadow-sm]="authMode() === 'login'" class="flex-1 py-2 text-sm font-bold rounded-md transition">Sign In</button>
              <button (click)="authMode.set('register'); authError.set('')" [class.bg-white]="authMode() === 'register'" [class.shadow-sm]="authMode() === 'register'" class="flex-1 py-2 text-sm font-bold rounded-md transition">Register</button>
            </div>

            @if (authError()) {
              <div class="bg-red-50 text-red-600 border border-red-200 p-3 rounded-lg text-sm mb-4 font-bold">{{ authError() }}</div>
            }

            <div class="space-y-4">
              
              @if (loginType() === 'official') {
                <div>
                  <label class="block text-sm font-medium text-slate-700 mb-1">Access Role</label>
                  <select (change)="selectedLoginRole.set($any($event.target).value)" class="w-full border border-slate-300 rounded-lg p-3 bg-white outline-none focus:ring-2 focus:ring-blue-500 font-medium">
                    <option value="admin">Department Official</option>
                    <option value="superadmin">System Super Admin</option>
                  </select>
                </div>

                @if (selectedLoginRole() === 'admin') {
                  <div class="animate-fade-in">
                    <label class="block text-sm font-medium text-slate-700 mb-1">Select Department</label>
                    <select (change)="selectedDeptId.set($any($event.target).value)" class="w-full border border-slate-300 rounded-lg p-3 bg-white outline-none focus:ring-2 focus:ring-blue-500 font-medium">
                      @for (dept of departments; track dept.id) {
                        <option [value]="dept.id">{{ dept.name }}</option>
                      }
                    </select>
                  </div>
                }
              }

              <div [class.hidden]="authMode() === 'login'" class="animate-fade-in">
                <label class="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                <input #nameInput type="text" class="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500" placeholder="Enter your full name">
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">
                  @if (loginType() === 'citizen') { Gov ID Proof (Aadhaar / Voter ID) }
                  @else if (selectedLoginRole() === 'admin') { Unique Employee ID }
                  @else { Root Super Admin ID }
                </label>
                <input #idInput type="text" class="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase" placeholder="Enter Unique ID">
              </div>

              <div>
                <label class="block text-sm font-medium text-slate-700 mb-1">Secure Password</label>
                <input #passInput type="password" class="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500" placeholder="••••••••" value="admin123">
              </div>
              
              <button [disabled]="isAuthenticating()" (click)="processAuth(authMode() === 'register', nameInput.value, idInput.value, passInput.value)" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition mt-4 disabled:opacity-50">
                {{ isAuthenticating() ? 'Processing...' : (authMode() === 'register' ? 'Register Account' : 'Secure Login') }}
              </button>
              <button [disabled]="isAuthenticating()" (click)="navigate('landing')" class="w-full text-slate-500 py-2 mt-2">Cancel</button>
            </div>
          </div>
        }

        @if (currentView() === 'dashboard') {
          
          @if (currentUser()?.role === 'citizen') {
            <div class="animate-fade-in space-y-6">
              <h2 class="text-2xl font-bold flex items-center justify-between">
                My Reports
                <span class="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded-full font-mono">ID: {{ currentUser()?.govId }}</span>
              </h2>
              <button (click)="startGuestReport()" class="w-full border-2 border-dashed border-blue-300 text-blue-700 font-bold py-4 rounded-xl hover:bg-blue-50 transition">
                + File New Report
              </button>
              <div class="space-y-3">
                @if (citizenIssues().length === 0) { <p class="text-slate-500 text-sm text-center py-4">No reports filed under this Aadhaar/ID.</p> }
                @for (issue of citizenIssues(); track issue.id) {
                  <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-100 flex gap-4 items-center">
                    <img [src]="issue.photoUrl" class="w-16 h-16 rounded-lg object-cover bg-slate-200">
                    <div class="flex-1">
                      <div class="flex justify-between items-start">
                        <span class="font-bold text-sm">{{ getDeptName(issue.deptId) }}</span>
                        <span [class]="getStatusClass(issue.status)" class="text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border">
                          {{ issue.status }}
                        </span>
                      </div>
                      <p class="text-xs text-slate-800 mt-1 line-clamp-2 font-medium">{{ issue.desc }}</p>
                      <p class="text-[10px] text-slate-400 mt-1">{{ issue.timestamp | date:'short' }}</p>
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          @if (currentUser()?.role === 'admin') {
            <div class="animate-fade-in space-y-6">
              <div class="flex justify-between items-start">
                <div>
                  <h2 class="text-xl font-bold flex items-center gap-2">
                    <span class="w-3 h-3 bg-red-500 rounded-full animate-pulse inline-block"></span> HQ: {{ getDeptName(currentUser()!.deptId!) }}
                  </h2>
                  <p class="text-xs text-slate-500 mt-1">Live Ticket Management System</p>
                </div>
                <span class="text-[10px] bg-blue-100 text-blue-800 px-2 py-1 rounded font-bold font-mono border border-blue-200">EMP ID: {{ currentUser()?.govId }}</span>
              </div>

              <div class="flex gap-2 p-1 bg-slate-200 rounded-lg">
                <button (click)="adminTab.set('tickets')" [class.bg-white]="adminTab() === 'tickets'" [class.shadow-sm]="adminTab() === 'tickets'" class="flex-1 py-1.5 text-sm font-bold rounded-md transition">Live Tickets</button>
                <button (click)="adminTab.set('team')" [class.bg-white]="adminTab() === 'team'" [class.shadow-sm]="adminTab() === 'team'" class="flex-1 py-1.5 text-sm font-bold rounded-md transition">Team Mgt</button>
              </div>

              @if (adminTab() === 'tickets') {
                <div class="space-y-4">
                  @if (adminIssues().length === 0) { <p class="text-slate-500 text-sm text-center py-4">No active tickets for this department.</p> }
                  @for (issue of adminIssues(); track issue.id) {
                    <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                      <div class="flex gap-4">
                        <img [src]="issue.photoUrl" class="w-20 h-24 rounded-lg object-cover bg-slate-200 border border-slate-100">
                        <div class="flex-1">
                          <div class="flex justify-between items-start mb-1">
                            <span class="font-mono text-xs font-bold text-slate-500">{{ issue.id }}</span>
                            <span class="text-[10px] text-slate-400">{{ issue.timestamp | date:'shortTime' }}</span>
                          </div>
                          <p class="text-sm text-slate-800 font-medium mb-3">{{ issue.desc }}</p>
                          
                          <div class="flex flex-col gap-1">
                            <label class="text-[10px] font-bold text-slate-500 uppercase">Current Status</label>
                            <select [value]="issue.status" (change)="updateIssueStatus(issue.id, $any($event.target).value)" 
                                    [class]="getStatusClass(issue.status)" class="w-full border rounded-lg p-2 text-xs font-bold outline-none cursor-pointer">
                              <option value="Request">🔴 Request (Unassigned)</option>
                              <option value="Active">🔵 Active (Working on it)</option>
                              <option value="Hold">🟠 Hold (Temporarily stopped)</option>
                              <option value="Resolved">🟢 Resolved (Completed)</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }

              @if (adminTab() === 'team') {
                <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-4">
                  <h3 class="font-bold text-slate-800 border-b pb-2">Current Team Members</h3>
                  <div class="space-y-2 mb-6">
                    @for (member of myTeamMembers(); track member.id) {
                      <div class="flex justify-between items-center p-3 bg-slate-50 rounded-lg border border-slate-100">
                        <div class="flex items-center gap-3">
                          <div class="w-8 h-8 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold text-xs uppercase">
                            {{ member.name.charAt(0) }}
                          </div>
                          <div>
                            <p class="text-sm font-bold text-slate-800">{{ member.name }} <span class="text-xs text-blue-600 font-normal">({{ member.designation || 'Alert Handler' }})</span> {{ member.govId === currentUser()?.govId ? '(You)' : '' }}</p>
                            <p class="text-[10px] text-slate-500 font-mono">EMP ID: {{ member.govId }} <span *ngIf="member.contactNumber">| 📞 {{ member.contactNumber }}</span></p>
                          </div>
                        </div>
                        <span class="text-[10px] bg-green-50 text-green-700 px-2 py-1 rounded border border-green-200 font-bold">Active</span>
                      </div>
                    }
                  </div>

                  <h3 class="font-bold text-slate-800 border-b pb-2">Request Access Changes</h3>
                  <p class="text-xs text-slate-500 mb-4">Requests are sent to the Super Admin for approval.</p>
                  
                  <div class="space-y-3">
                    <div>
                      <label class="block text-xs font-bold text-slate-700 mb-1">Action</label>
                      <select (change)="reqActionType.set($any($event.target).value)" class="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none bg-white">
                        <option value="Add Member">Request New Member Slot</option>
                        <option value="Delete Member">Revoke Member Access</option>
                      </select>
                    </div>

                    @if (reqActionType() === 'Delete Member') {
                      <div class="animate-fade-in">
                        <label class="block text-xs font-bold text-slate-700 mb-1">Select Team Member to Remove</label>
                        <select (change)="reqDeleteTarget.set($any($event.target).value)" class="w-full border border-slate-300 rounded-lg p-2 text-sm outline-none bg-white">
                          <option value="" disabled selected>-- Select a member --</option>
                          @for (member of myTeamMembers(); track member.id) {
                            <option [value]="member.name + ' (' + member.govId + ')'">
                              {{ member.name }} {{ member.govId === currentUser()?.govId ? '(You)' : '' }}
                            </option>
                          }
                        </select>
                      </div>
                    }

                    <button (click)="submitTeamReq()" class="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-xl text-sm transition">
                      Submit Request to Super Admin
                    </button>
                  </div>

                  <h3 class="font-bold text-slate-800 border-b pb-2 pt-4 mt-4">My Past Requests</h3>
                  <div class="space-y-2">
                    @for (req of myDeptRequests(); track req.id) {
                      <div class="flex justify-between items-center p-2 bg-slate-50 rounded border border-slate-100">
                        <div>
                          <span class="text-xs font-bold">{{ req.type }}:</span>
                          <span class="text-xs text-slate-600 ml-1">{{ req.targetName }}</span>
                        </div>
                        <span [class]="getReqStatusClass(req.status)" class="text-[10px] px-2 py-0.5 rounded uppercase font-bold border">{{ req.status }}</span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }

          @if (currentUser()?.role === 'superadmin') {
            <div class="animate-fade-in space-y-6">
              <div class="flex justify-between items-start">
                <h2 class="text-2xl font-bold flex items-center gap-2 text-indigo-900">
                  <span>🛡️</span> System Admin Root
                </h2>
                <span class="text-[10px] bg-indigo-100 text-indigo-800 px-2 py-1 rounded font-bold font-mono border border-indigo-200">ROOT: {{ currentUser()?.govId }}</span>
              </div>
              
              <div class="grid grid-cols-2 gap-4">
                <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-100 text-center">
                  <div class="text-3xl font-bold text-indigo-600">{{ pendingRequests().length }}</div>
                  <div class="text-xs text-indigo-800 font-medium uppercase mt-1">Pending Reqs</div>
                </div>
                <div class="bg-slate-100 p-4 rounded-xl border border-slate-200 text-center">
                  <div class="text-3xl font-bold text-slate-600">{{ allIssues().length }}</div>
                  <div class="text-xs text-slate-500 font-medium uppercase mt-1">Total System Tickets</div>
                </div>
              </div>

              <div class="flex gap-2 p-1 bg-indigo-50 rounded-lg border border-indigo-100">
                <button (click)="superAdminTab.set('requests')" [class.bg-white]="superAdminTab() === 'requests'" [class.shadow-sm]="superAdminTab() === 'requests'" class="flex-1 py-1.5 text-sm font-bold rounded-md transition text-indigo-900">Access Requests</button>
                <button (click)="superAdminTab.set('employees')" [class.bg-white]="superAdminTab() === 'employees'" [class.shadow-sm]="superAdminTab() === 'employees'" class="flex-1 py-1.5 text-sm font-bold rounded-md transition text-indigo-900">Employee Mgmt</button>
              </div>

              @if (superAdminTab() === 'requests') {
                <div class="mt-2">
                  <h3 class="font-bold mb-3 text-slate-800">Pending Role Requests</h3>
                  @if (pendingRequests().length === 0) {
                    <p class="text-slate-500 text-sm text-center py-8 bg-white rounded-xl border border-slate-100">No pending access requests.</p>
                  }
                  <div class="space-y-3">
                    @for (req of pendingRequests(); track req.id) {
                      <div class="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                        <div class="flex justify-between items-start mb-2">
                          <div>
                            <span class="text-xs font-bold bg-slate-100 px-2 py-1 rounded">{{ getDeptName(req.deptId) }}</span>
                            <span class="text-xs text-slate-500 ml-2">by {{ req.requestedBy }}</span>
                          </div>
                          <span class="text-[10px] text-slate-400">{{ req.timestamp | date:'shortDate' }}</span>
                        </div>
                        <p class="text-sm font-bold text-slate-800 mb-4">{{ req.type }}: <span class="text-blue-600">{{ req.targetName }}</span></p>
                        
                        <div class="flex gap-2">
                          <button (click)="resolveAdminRequest(req.id, 'Rejected')" class="flex-1 py-2 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg border border-red-200 transition">Reject</button>
                          <button (click)="resolveAdminRequest(req.id, 'Approved')" class="flex-1 py-2 text-xs font-bold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg border border-green-200 transition">Approve</button>
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }

              @if (superAdminTab() === 'employees') {
                <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-200 mt-2 space-y-4">
                  <div class="flex justify-between items-center border-b pb-2">
                    <h3 class="font-bold text-slate-800">Employee Directory</h3>
                    <button (click)="openAddEmployee()" class="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg font-bold transition shadow-sm">+ Add New</button>
                  </div>

                  @if (isEmployeeFormOpen()) {
                    <div class="bg-indigo-50 p-4 rounded-xl border border-indigo-100 space-y-3 mb-6 animate-fade-in">
                      <h4 class="font-bold text-sm text-indigo-900">{{ editingEmployee() ? 'Edit' : 'Add' }} Employee</h4>
                      @if (employeeFormError()) { <p class="text-red-600 text-xs font-bold">{{ employeeFormError() }}</p> }
                      
                      <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
                        <input #empName [value]="editingEmployee()?.name || ''" type="text" class="w-full border border-slate-300 rounded p-2 text-sm outline-none focus:border-indigo-400">
                      </div>
                      <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">Employee ID (Gov ID)</label>
                        <input #empId [value]="editingEmployee()?.govId || ''" type="text" class="w-full border border-slate-300 rounded p-2 text-sm outline-none font-mono focus:border-indigo-400">
                      </div>
                      <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">Contact Number</label>
                        <input #empContact [value]="editingEmployee()?.contactNumber || ''" type="text" class="w-full border border-slate-300 rounded p-2 text-sm outline-none font-mono focus:border-indigo-400" placeholder="e.g. 9876543210">
                      </div>
                      <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">Designation</label>
                        <select #empDesig class="w-full border border-slate-300 rounded p-2 text-sm outline-none focus:border-indigo-400 bg-white">
                          @for (desig of designations; track desig) {
                            <option [value]="desig" [selected]="(editingEmployee()?.designation || 'Alert Handler') === desig">{{ desig }}</option>
                          }
                        </select>
                      </div>
                      <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1">Department Assigned</label>
                        <select #empDept class="w-full border border-slate-300 rounded p-2 text-sm outline-none focus:border-indigo-400 bg-white">
                          @for (dept of departments; track dept.id) {
                            <option [value]="dept.id" [selected]="editingEmployee()?.deptId === dept.id">{{ dept.name }}</option>
                          }
                        </select>
                      </div>
                      <div class="flex gap-2 pt-2">
                        <button (click)="saveEmployee(empName.value, empId.value, empContact.value, empDept.value, empDesig.value)" class="flex-1 bg-indigo-600 hover:bg-indigo-700 transition text-white text-xs font-bold py-2 rounded">Save Employee</button>
                        <button (click)="isEmployeeFormOpen.set(false)" class="flex-1 bg-slate-200 hover:bg-slate-300 transition text-slate-700 text-xs font-bold py-2 rounded">Cancel</button>
                      </div>
                    </div>
                  }

                  <div class="space-y-6 pt-2">
                    @for (dept of departments; track dept.id) {
                      <div>
                        <h4 class="font-bold text-xs text-indigo-800 uppercase mb-2 flex items-center gap-2">
                          <span>{{ dept.icon }}</span> {{ dept.name }}
                        </h4>
                        <div class="space-y-2">
                          @for (emp of getEmployeesByDept(dept.id); track emp.id) {
                            <div class="flex justify-between items-center p-2 bg-slate-50 border border-slate-100 rounded-lg hover:border-indigo-200 transition">
                              <div>
                                <p class="text-sm font-bold text-slate-800">{{ emp.name }} <span class="text-xs text-indigo-600 font-normal">({{ emp.designation || 'Alert Handler' }})</span></p>
                                <p class="text-[10px] text-slate-500 font-mono">ID: {{ emp.govId }} <span *ngIf="emp.contactNumber">| 📞 {{ emp.contactNumber }}</span></p>
                              </div>
                              <button (click)="openEditEmployee(emp)" class="text-xs bg-slate-200 hover:bg-slate-300 text-slate-700 px-3 py-1 rounded font-bold transition">Edit</button>
                            </div>
                          }
                          @if (getEmployeesByDept(dept.id).length === 0) {
                            <p class="text-xs text-slate-400 italic p-2 bg-slate-50 rounded-lg">No employees assigned to this department.</p>
                          }
                        </div>
                      </div>
                    }
                  </div>

                </div>
              }
            </div>
          }
        }

        @if (currentView() === 'departments') {
          <div class="animate-fade-in">
            <h2 class="text-2xl font-bold mb-2">Select Department</h2>
            <p class="text-slate-600 text-sm mb-6">Which authority handles this issue?</p>
            <div class="grid grid-cols-2 gap-3">
              @for (dept of departments; track dept.id) {
                <button (click)="selectDepartment(dept)" class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 text-left hover:border-blue-300 hover:shadow-md transition active:scale-95 flex flex-col items-start gap-2">
                  <span class="text-3xl">{{ dept.icon }}</span>
                  <span class="font-bold text-sm leading-tight">{{ dept.name }}</span>
                </button>
              }
            </div>
            <button (click)="navigate(currentUser() ? 'dashboard' : 'landing')" class="w-full text-slate-500 py-4 mt-4 text-sm">Cancel</button>
          </div>
        }

        @if (currentView() === 'capture') {
          <div class="animate-fade-in space-y-4">
            <div class="bg-blue-50 p-3 rounded-xl border border-blue-100 flex justify-between items-center">
              <div>
                <p class="font-bold text-sm text-blue-900">{{ activeDept()?.icon }} {{ activeDept()?.name }}</p>
                <p class="text-xs text-blue-700">Emergency: <a [href]="'tel:' + activeDept()?.emergency" class="font-bold underline">{{ activeDept()?.emergency }}</a></p>
              </div>
              <button (click)="startGuestReport()" class="text-xs bg-blue-200 text-blue-800 px-3 py-1.5 rounded-lg hover:bg-blue-300 transition">Change</button>
            </div>

            @if (!capturedImage()) {
              <div class="relative rounded-2xl overflow-hidden bg-black aspect-[3/4] shadow-inner">
                <video #videoElement autoplay playsinline class="w-full h-full object-cover" [class.hidden]="!isCameraReady()"></video>
                
                @if (!isCameraReady()) {
                  <div class="absolute inset-0 flex flex-col items-center justify-center text-white/50 p-6 text-center">
                    <span class="animate-spin text-3xl mb-4">⏳</span>
                    <p class="text-sm">Requesting Camera & GPS Access...</p>
                    <p class="text-xs mt-2 text-white/30">(If blocked, a mock image will be used)</p>
                  </div>
                }

                @if (isCameraReady()) {
                  <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 p-4 pt-10 text-white pointer-events-none">
                    <div class="flex items-center gap-2 text-xs font-mono mb-1 text-red-400">
                      <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span> LIVE
                    </div>
                    <p class="text-sm font-medium">{{ locationData()?.address || 'Acquiring GPS...' }}</p>
                    <p class="text-[10px] text-white/70 mt-1 font-mono">
                      {{ locationData()?.lat | number:'1.4-4' }}, {{ locationData()?.lng | number:'1.4-4' }} • {{ currentTime() | date:'medium' }}
                    </p>
                  </div>
                }
              </div>

              <button [disabled]="!isCameraReady()" (click)="capturePhoto()" class="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-bold py-4 rounded-xl shadow-md transition transform active:scale-95 flex justify-center items-center gap-2 text-lg">
                <span class="text-2xl">📸</span> Capture Evidence
              </button>
            }

            @if (capturedImage()) {
              <div class="bg-white p-2 rounded-2xl shadow-sm border border-slate-100">
                <img [src]="capturedImage()" class="w-full rounded-xl" alt="Evidence">
              </div>

              <div class="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
                <label class="block text-sm font-bold text-slate-800 mb-2">Describe the Issue</label>
                <textarea #descInput rows="3" class="w-full border border-slate-300 rounded-lg p-3 outline-none focus:ring-2 focus:ring-blue-500 text-sm" placeholder="E.g., Water pipe burst leaking onto main road..."></textarea>
                @if (formError()) {
                  <p class="text-red-600 text-xs mt-2 font-bold">{{ formError() }}</p>
                }
              </div>

              <div class="flex flex-col gap-2">
                <button [disabled]="isSubmitting()" (click)="submitIssue(descInput.value)" class="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-bold py-4 rounded-xl shadow-md transition transform active:scale-95 text-lg flex justify-center items-center gap-2">
                  @if (isSubmitting()) {
                    <span class="animate-spin">⏳</span> Submitting...
                  } @else {
                    Submit Ticket
                  }
                </button>
                <button [disabled]="isSubmitting()" (click)="retakePhoto()" class="w-full text-slate-500 py-3 font-medium transition active:scale-95">Retake Photo</button>
              </div>
            }
            
            <canvas #canvasElement class="hidden"></canvas>
          </div>
        }

        @if (currentView() === 'success') {
          <div class="animate-fade-in bg-white p-8 rounded-2xl shadow-sm border border-slate-100 text-center mt-10">
            <div class="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6 text-4xl">✓</div>
            <h2 class="text-2xl font-bold mb-2">Issue Reported!</h2>
            <p class="text-slate-600 text-sm mb-2">Ticket Ref: <span class="font-mono font-bold text-slate-900">{{ lastTicketRef() }}</span></p>
            
            <div class="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-left">
              <p class="text-sm text-green-900 font-bold mb-2">✓ Dispatched via WhatsApp & DB Updates!</p>
              <p class="text-xs text-green-800">1. Dashboard has been updated via Firebase.</p>
              <p class="text-xs text-green-800">2. WhatsApp notification sent to the designated official.</p>
            </div>

            <button (click)="navigate(currentUser() ? 'dashboard' : 'landing')" class="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-4 rounded-xl transition active:scale-95">
              {{ currentUser() ? 'Back to Dashboard' : 'Return Home' }}
            </button>
          </div>
        }

      </main>
    </div>
  `,
  styles: [`
    .animate-fade-in { animation: fadeIn 0.2s ease-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
  `]
})
export class VAlertComponent implements OnInit, OnDestroy {
  // State
  currentView = signal<ViewState>('landing');
  currentUser = signal<User | null>(null);
  
  // Login Flow State
  loginType = signal<'citizen' | 'official'>('citizen');
  authMode = signal<'login' | 'register'>('login');
  selectedLoginRole = signal<string>('citizen');
  selectedDeptId = signal<string>('1');
  authError = signal<string>('');
  isAuthenticating = signal<boolean>(false);
  
  // Admin / Super Admin Sub-Tabs
  adminTab = signal<'tickets' | 'team'>('tickets');
  superAdminTab = signal<'requests' | 'employees'>('requests');
  
  // Team Mgt Signals
  reqActionType = signal<'Add Member' | 'Delete Member'>('Add Member');
  reqDeleteTarget = signal<string>('');

  // Super Admin Employee Form Signals
  isEmployeeFormOpen = signal<boolean>(false);
  editingEmployee = signal<User | null>(null);
  employeeFormError = signal<string>('');

  activeDept = signal<Department | null>(null);
  capturedImage = signal<string | null>(null);
  lastTicketRef = signal<string>('');
  formError = signal<string>('');
  isSubmitting = signal<boolean>(false);
  
  isCameraReady = signal(false);
  locationData = signal<{lat: number, lng: number, address: string} | null>(null);
  currentTime = signal<Date>(new Date());

  // Data Signals
  allIssues = signal<Issue[]>([]);
  allRequests = signal<AdminReq[]>([]);
  allOfficials = signal<User[]>([]);

  // Computed Views
  citizenIssues = computed(() => {
    const user = this.currentUser();
    if (!user) return [];
    return this.allIssues().filter(i => i.userId === user.id);
  });
  
  adminIssues = computed(() => this.allIssues().filter(i => i.deptId === this.currentUser()?.deptId));
  pendingRequests = computed(() => this.allRequests().filter(r => r.status === 'Pending'));
  myDeptRequests = computed(() => this.allRequests().filter(r => r.deptId === this.currentUser()?.deptId));
  resolvedCount = computed(() => this.allIssues().filter(i => i.status === 'Resolved').length);
  
  myTeamMembers = computed(() => {
    const current = this.currentUser();
    if (current?.role !== 'admin') return [];
    const mockTeam = this.allOfficials().filter(u => u.deptId === current.deptId);
    if (!mockTeam.find(u => u.govId === current.govId)) mockTeam.unshift(current);
    return mockTeam;
  });

  @ViewChild('videoElement') videoElement?: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement?: ElementRef<HTMLCanvasElement>;

  private mediaStream: MediaStream | null = null;
  private timeInterval: any;
  private db: any = null;
  private auth: any = null;
  private appId: string = 'default-app-id';

  designations = ['Alert Handler', 'Chief Officer', 'Inspector', 'Supervisor', 'Engineer', 'Line Chief', 'Health Officer'];

  departments: Department[] = [
    { id: 1, name: 'Fire Department', icon: '🔥', emergency: '6304084803', signalApiKey: 'dummy_key_1', whatsappApiKey: 'dummy_wa_1', desc: 'Building fires, gas leaks, extreme hazards.' },
    { id: 2, name: 'GVMC Municipal', icon: '🏙️', emergency: '7396533156', signalApiKey: 'dummy_key_2', whatsappApiKey: 'dummy_wa_2', desc: 'Garbage, drainage, damaged roads, streetlights.' },
    { id: 3, name: 'Water Supply', icon: '💧', emergency: '9705706928', signalApiKey: 'dummy_key_3', whatsappApiKey: 'dummy_wa_3', desc: 'Burst pipes, contamination, no supply.' },
    { id: 4, name: 'Electricity (APEPDCL)', icon: '⚡', emergency: '6304084803', signalApiKey: 'dummy_key_1', whatsappApiKey: 'dummy_wa_1', desc: 'Power outages, fallen lines, sparks.' },
    { id: 5, name: 'Traffic Police', icon: '🚦', emergency: '7396533156', signalApiKey: 'dummy_key_2', whatsappApiKey: 'dummy_wa_2', desc: 'Signal failures, major jams, accidents.' },
    { id: 6, name: 'Health & Sanitation', icon: '🏥', emergency: '9705706928', signalApiKey: 'dummy_key_3', whatsappApiKey: 'dummy_wa_3', desc: 'Illegal dumping, dead strays, disease outbreaks.' }
  ];

  ngOnInit() {
    this.timeInterval = setInterval(() => this.currentTime.set(new Date()), 1000);
    this.seedMockData();
    // CALLING EXACT FIREBASE INIT FROM ORIGINAV1
    this.initFirebase();
  }

  seedMockData() {
    this.allOfficials.set([
      { id: 'USR-MOCK-1', name: 'K. Rao', role: 'admin', deptId: 1, govId: 'EMP-F01', contactNumber: '6304084803', designation: 'Chief Officer' },
      { id: 'USR-MOCK-2', name: 'Srinivas', role: 'admin', deptId: 2, govId: 'EMP-M01', contactNumber: '7396533156', designation: 'Alert Handler' },
      { id: 'USR-MOCK-3', name: 'Lakshmi', role: 'admin', deptId: 2, govId: 'EMP-M02', contactNumber: '9876543210', designation: 'Supervisor' },
      { id: 'USR-MOCK-4', name: 'V. Reddy', role: 'admin', deptId: 3, govId: 'EMP-W01', contactNumber: '9705706928', designation: 'Alert Handler' },
      { id: 'USR-MOCK-5', name: 'Prasad', role: 'admin', deptId: 4, govId: 'EMP-E01', contactNumber: '6304084803', designation: 'Line Chief' },
      { id: 'USR-MOCK-6', name: 'Kumar', role: 'admin', deptId: 5, govId: 'EMP-T01', contactNumber: '7396533156', designation: 'Alert Handler' },
      { id: 'USR-MOCK-7', name: 'Dr. Rani', role: 'admin', deptId: 6, govId: 'EMP-H01', contactNumber: '9705706928', designation: 'Health Officer' }
    ]);
  }

  // EXACT FIREBASE INITIALIZATION PRESERVED FROM ORIGINAV1
  async initFirebase() {
    if (environment.apiKey) {
      const app = initializeApp(environment);
      this.auth = getAuth(app);
      this.db = getFirestore(app);
      this.appId = environment.appId || 'default-app-id';
      try {
        // Authenticate anonymously using real Firebase configuration
        await signInAnonymously(this.auth);
        const alertsRef = collection(this.db, 'artifacts', this.appId, 'public', 'data', 'alerts');
        let isInitialLoad = true;
        onSnapshot(alertsRef, (snapshot) => {
          if (!isInitialLoad && this.currentUser()?.role === 'admin') {
             snapshot.docChanges().forEach((change) => {
               if (change.type === 'added') {
                 const newAlert = change.doc.data() as Issue;
                 if (newAlert.deptId === this.currentUser()?.deptId) {
                    this.triggerAlertNotification(newAlert);
                 }
               }
             });
          }
          isInitialLoad = false;

          const issues = snapshot.docs.map(doc => ({ ...doc.data(), firebaseId: doc.id } as any));
          issues.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          this.allIssues.set(issues);
        }, (error) => console.error("Firebase Snapshot Error:", error));
      } catch (err) {
        console.error("Firebase Auth Error:", err);
      }
    }
  }

  ngOnDestroy() {
    this.stopCamera();
    clearInterval(this.timeInterval);
  }

  // --- Auth & Access Logic (Mocked to align with anonymous Firebase in V1) ---
  openLogin(type: 'citizen' | 'official') {
    this.loginType.set(type);
    this.authMode.set('login');
    this.authError.set('');
    this.selectedLoginRole.set(type === 'citizen' ? 'citizen' : 'admin');
    this.selectedDeptId.set('1'); 
    this.navigate('login');
  }

  processAuth(isRegister: boolean, name: string, idVal: string, pass: string) {
    this.authError.set('');
    if (!idVal.trim()) return this.authError.set('Unique ID Proof is mandatory.');
    if (!pass.trim() || pass.length < 6) return this.authError.set('Password is required (min 6 characters).');
    if (isRegister && !name.trim()) return this.authError.set('Full Name is required for registration.');

    this.isAuthenticating.set(true);
    const role = this.selectedLoginRole() as UserRole;
    const deptId = role === 'admin' ? parseInt(this.selectedDeptId()) : undefined;

    // Simulate login to safely keep the anonymous Firebase connection from originav1 working
    setTimeout(() => {
      this.currentUser.set({ 
        id: `USR-${Math.floor(Math.random()*1000)}`, 
        name: name || (role === 'superadmin' ? 'Super Admin' : (role === 'admin' ? 'Official Admin' : 'Citizen')), 
        role, 
        deptId, 
        govId: idVal, 
        designation: role === 'admin' ? 'Alert Handler' : undefined 
      });
      this.navigate('dashboard');
      this.isAuthenticating.set(false);
    }, 800);
  }

  logoutUser() {
    this.currentUser.set(null);
    this.navigate('landing');
  }

  navigate(view: ViewState) {
    if (view !== 'capture') {
      this.stopCamera();
      this.capturedImage.set(null); 
    }
    this.formError.set(''); 
    this.currentView.set(view);
    
    if (view === 'dashboard' && this.currentUser()?.role === 'admin') {
       if ('Notification' in window && Notification.permission !== 'granted') {
         Notification.requestPermission();
       }
    }
  }

  // --- UI Helpers ---
  getDeptName(id: number): string { return this.departments.find(d => d.id === id)?.name || 'Unknown'; }
  
  getStatusClass(status: string) {
    switch(status) {
      case 'Request': return 'bg-slate-100 text-slate-600 border-slate-300';
      case 'Active': return 'bg-blue-100 text-blue-700 border-blue-300';
      case 'Hold': return 'bg-orange-100 text-orange-700 border-orange-300';
      case 'Resolved': return 'bg-green-100 text-green-700 border-green-300';
      default: return 'bg-slate-100 text-slate-600';
    }
  }

  getReqStatusClass(status: string) {
    return status === 'Pending' ? 'bg-amber-100 text-amber-700 border-amber-300' :
           status === 'Approved' ? 'bg-green-100 text-green-700 border-green-300' : 
           'bg-red-100 text-red-700 border-red-300';
  }

  // --- Admin Logic ---
  updateIssueStatus(issueId: string, newStatus: string) {
    this.allIssues.update(issues => issues.map(i => i.id === issueId ? { ...i, status: newStatus as IssueStatus } : i));
    const targetIssue = this.allIssues().find(i => i.id === issueId);
    if(targetIssue && (targetIssue as any).firebaseId && this.db) {
       updateDoc(doc(this.db, 'artifacts', this.appId, 'public', 'data', 'alerts', (targetIssue as any).firebaseId), { status: newStatus })
         .catch(e => console.warn("Firestore update blocked. Local state updated.", e));
    }
  }

  submitTeamReq() {
    const type = this.reqActionType();
    if (type === 'Delete Member' && !this.reqDeleteTarget()) return alert("Please select a team member from the dropdown to revoke their access.");
    const targetName = type === 'Add Member' ? 'Open New Slot' : this.reqDeleteTarget();
    this.allRequests.update(reqs => [{ id: `REQ-${Math.random()}`, deptId: this.currentUser()!.deptId!, type: type as any, targetName, status: 'Pending', requestedBy: this.currentUser()!.name, timestamp: new Date().toISOString() }, ...reqs]);
    this.reqDeleteTarget.set('');
  }

  resolveAdminRequest(reqId: string, status: 'Approved' | 'Rejected') {
    const req = this.allRequests().find(r => r.id === reqId);
    if (req && status === 'Approved') {
      if (req.type === 'Delete Member') {
        this.allOfficials.update(officials => officials.filter(o => `${o.name} (${o.govId})` !== req.targetName));
      } else if (req.type === 'Add Member') {
        this.superAdminTab.set('employees');
        this.openAddEmployee();
      }
    }
    this.allRequests.update(reqs => reqs.map(r => r.id === reqId ? { ...r, status } : r));
  }

  // --- Super Admin Logic (Employee Management) ---
  getEmployeesByDept(deptId: number) { return this.allOfficials().filter(u => u.deptId === deptId); }
  openAddEmployee() { this.editingEmployee.set(null); this.employeeFormError.set(''); this.isEmployeeFormOpen.set(true); }
  openEditEmployee(emp: User) { this.editingEmployee.set(emp); this.employeeFormError.set(''); this.isEmployeeFormOpen.set(true); }

  saveEmployee(name: string, govId: string, contact: string, deptIdStr: string, designation: string) {
    this.employeeFormError.set('');
    if (!name.trim()) return this.employeeFormError.set('Name is required.');
    if (!govId.trim()) return this.employeeFormError.set('Employee ID is required.');
    if (!contact.trim() || contact.replace(/[^0-9]/g, '').length < 10) {
      return this.employeeFormError.set('Valid contact number (min 10 digits) is required.');
    }
    if (!designation.trim()) designation = 'Alert Handler'; 

    const deptId = parseInt(deptIdStr);
    const editing = this.editingEmployee();

    if (editing) {
      if (this.allOfficials().some(o => o.govId === govId && o.id !== editing.id)) {
        return this.employeeFormError.set('An employee with this Employee ID already exists.');
      }
      this.allOfficials.update(officials =>
        officials.map(o => o.id === editing.id ? { ...o, name, govId, contactNumber: contact, deptId, designation } : o)
      );
    } else {
      if (this.allOfficials().some(o => o.govId === govId)) {
        return this.employeeFormError.set('An employee with this Employee ID already exists.');
      }
      const newEmp: User = { id: `USR-MOCK-${Math.floor(Math.random() * 10000)}`, name, role: 'admin', deptId, govId, contactNumber: contact, designation };
      this.allOfficials.update(officials => [...officials, newEmp]);
    }
    this.isEmployeeFormOpen.set(false);
  }

  // --- Notification & Hardware APIs ---
  enableNotifications() {
    if ('Notification' in window) {
      Notification.requestPermission();
    }
    this.playAudioDing(); 
  }

  triggerAlertNotification(issue: Issue) {
    this.playAudioDing();
    if ('Notification' in window && Notification.permission === 'granted') {
      const deptName = this.getDeptName(issue.deptId);
      new Notification(`🚨 New VizagAlert: ${deptName}`, {
        body: issue.desc,
        icon: 'https://cdn-icons-png.flaticon.com/512/564/564276.png' 
      });
    }
  }

  playAudioDing() {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); 
    oscillator.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 0.5);
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.5);
  }

  startGuestReport() { this.activeDept.set(null); this.navigate('departments'); }
  selectDepartment(dept: Department) { this.activeDept.set(dept); this.openCamera(); }

  async openCamera() {
    this.navigate('capture');
    this.capturedImage.set(null); 
    this.isCameraReady.set(false);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.locationData.set({ lat: pos.coords.latitude, lng: pos.coords.longitude, address: 'Approx: RTC Complex, Visakhapatnam' });
        },
        (err) => { this.locationData.set({ lat: 17.7292, lng: 83.3150, address: 'Visakhapatnam (Mock GPS)' }); }
      );
    }

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      setTimeout(() => {
        if (this.videoElement) {
          this.videoElement.nativeElement.srcObject = this.mediaStream;
          this.videoElement.nativeElement.onloadedmetadata = () => { this.isCameraReady.set(true); };
        }
      }, 50);
    } catch (err) {
      setTimeout(() => {
        if(!this.locationData()) this.locationData.set({ lat: 17.7292, lng: 83.3150, address: 'Visakhapatnam' });
        this.isCameraReady.set(true);
      }, 1000);
    }
  }

  stopCamera() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    this.isCameraReady.set(false);
  }

  capturePhoto() {
    if (!this.videoElement || !this.canvasElement) return;
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    
    if (!this.mediaStream) {
      this.createMockCanvasImage();
      return;
    }

    const scale = Math.min(640 / video.videoWidth, 1);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.applyWatermark(canvas, ctx);
  }

  retakePhoto() {
    this.capturedImage.set(null);
    this.formError.set('');
    this.openCamera();
  }

  private applyWatermark(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
    const loc = this.locationData();
    const timeStr = this.currentTime().toLocaleString();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, canvas.height - 80, canvas.width, 80);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '16px monospace';
    ctx.fillText(`🚨 VIZAG ALERT | ${timeStr}`, 15, canvas.height - 50);
    ctx.fillText(`📍 ${loc?.address || 'Unknown Location'}`, 15, canvas.height - 25);
    ctx.font = '12px monospace';
    ctx.fillStyle = '#AAAAAA';
    ctx.fillText(`GPS: ${loc?.lat.toFixed(5)}, ${loc?.lng.toFixed(5)}`, canvas.width - 200, canvas.height - 25);
    this.capturedImage.set(canvas.toDataURL('image/jpeg', 0.8));
    this.stopCamera();
  }

  private createMockCanvasImage() {
    const canvas = this.canvasElement!.nativeElement;
    canvas.width = 480; canvas.height = 640;
    const ctx = canvas.getContext('2d');
    if(!ctx) return;
    ctx.fillStyle = '#1e293b'; ctx.fillRect(0,0, canvas.width, canvas.height);
    ctx.fillStyle = '#334155'; ctx.beginPath(); ctx.arc(240, 200, 80, 0, 2*Math.PI); ctx.fill();
    ctx.fillStyle = '#64748b'; ctx.fillText('MOCK HARDWARE CAMERA', 160, 320);
    this.applyWatermark(canvas, ctx);
  }

  // --- SUBMISSION LOGIC WITH EXACT TWILIO/FIREBASE IMPLEMENTATION FROM ORIGINAV1 ---
  async submitIssue(description: string) {
    if (!description.trim()) {
      this.formError.set('Please describe the issue briefly before submitting.');
      return;
    }
    
    this.formError.set(''); 
    this.isSubmitting.set(true);

    const newIssue: Issue = {
      id: `VZG-${Math.floor(Math.random() * 9000) + 1000}`,
      deptId: this.activeDept()!.id,
      userId: this.currentUser()?.id || 'GUEST',
      desc: description,
      status: 'Request', // Updated to match vizagalert2 IssueStatus types
      timestamp: new Date().toISOString(),
      photoUrl: this.capturedImage()!
    };

    // 1. TWILIO WHATSAPP PUSH NOTIFICATION (EXACT LOGIC PRESERVED)
    try {
      const accountSid = environment.twilioAccountSid || 'YOUR_TWILIO_ACCOUNT_SID';
      const authToken = environment.twilioAuthToken || 'YOUR_TWILIO_AUTH_TOKEN';
      const twilioFrom = environment.twilioFromNumber || 'whatsapp:+14155238886'; 
      const twiliotemplatesid = environment.twiliotemplatesid ||'Twilio_WhatsApp_ID' ;
      
      const activeDepartment = this.activeDept()!;
      
      const rawNumbers = typeof activeDepartment.emergency === 'string' 
          ? activeDepartment.emergency.split(',').map(n => n.trim()) 
          : [...activeDepartment.emergency]; // Making a copy since it might be an array

      rawNumbers.push('+919705706928');//manohar
      rawNumbers.push('+919441467182');//swetha
      rawNumbers.push('+919959177699');//sudaker
      rawNumbers.push('+919836358282');//Ravi
      rawNumbers.push('+919676626436');//sudeer
      rawNumbers.push('+919959978628');//aruna
      rawNumbers.push('+919885351005');//bhanu

      console.log(`Dispatching VizagAlert Template to ${rawNumbers.length} numbers...`);

      const messagePromises = rawNumbers.map(async (num: string) => {
          let phoneStr = num.replace(/[^0-9+]/g, '');
          
          if (!phoneStr.startsWith('+')) {
              phoneStr = `+91${phoneStr}`;
          }

          let safeFrom = twilioFrom;
          if (!safeFrom.startsWith('whatsapp:')) {
              safeFrom = `whatsapp:${safeFrom}`;
          }

          const twilioTo = `whatsapp:${phoneStr}`;
          const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
          
          const bodyParams = new URLSearchParams({
            To: twilioTo,
            From: safeFrom,
            ContentSid: 'HXb5b62575e6e4ff6129ad7c8efe1f983e', 
            ContentVariables: JSON.stringify({
                "1": String(newIssue.id),             
                "2": `${activeDepartment.name} - Issue was: ${newIssue.desc}`
            }) 
          });

          try {
              const response = await fetch(url, {
                method: 'POST',
                headers: {
                  'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: bodyParams.toString()
              });

              if (!response.ok) {
                const errorData = await response.json();
                return { number: phoneStr, status: 'Failed', error: errorData.message || 'HTTP Error' };
              }
              return { number: phoneStr, status: 'Success', error: null };
          } catch (err) {
              return { number: phoneStr, status: 'Failed', error: err };
          }
      });

      const results = await Promise.all(messagePromises);
      console.log("Twilio WhatsApp notification batch completed.");
      console.table(results);

    } catch (e) {
      console.error("Twilio WhatsApp Notification failed to execute entirely", e);
    }

    // 2. SAVE TO FIREBASE USING REAL CONFIG (EXACT LOGIC PRESERVED)
    if (this.db) {
      try {
        const alertsRef = collection(this.db, 'artifacts', this.appId, 'public', 'data', 'alerts');
        await addDoc(alertsRef, newIssue);
      } catch (error) {
        console.error("Firebase Write Error:", error);
        this.formError.set('Failed to save to database. Check your Firestore rules.');
        this.isSubmitting.set(false);
        return;
      }
    } else {
      console.warn('Firebase DB or Auth not initialized. Falling back to local state.');
      this.allIssues.update(issues => [newIssue, ...issues]);
    }

    this.lastTicketRef.set(newIssue.id);
    this.isSubmitting.set(false);
    this.navigate('success');

    // Auto-redirect for anonymous guests
    if (!this.currentUser()) {
      setTimeout(() => {
        if (this.currentView() === 'success') this.navigate('landing');
      }, 3000);
    }
  }
}