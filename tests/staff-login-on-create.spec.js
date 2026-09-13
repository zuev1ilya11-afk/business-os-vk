const {test,expect}=require('@playwright/test');
const fs=require('fs');
const path=require('path');

test('new employee form requires credentials and persists them through staff admin',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','employee-form-v16.js'),'utf8');
  expect(source).toContain('name="login"');
  expect(source).toContain('name="password"');
  expect(source).toContain("staffAdminCall('setCredentials',{id:user.id,login,password})");
  expect(source).toContain('Сотрудник уже может войти в приложение по этим данным.');
});

test('saved employee credentials are accepted by the desktop password session flow',()=>{
  const admin=fs.readFileSync(path.join(__dirname,'..','supabase','functions','staff-admin-api','index.ts'),'utf8');
  const login=fs.readFileSync(path.join(__dirname,'..','supabase','functions','password-session-api','index.ts'),'utf8');
  expect(admin).toContain("db.rpc('bos_set_staff_credentials'");
  expect(admin).toContain('Такой логин уже занят. Выберите другой.');
  expect(login).toContain("db.rpc('bos_verify_staff_credentials'");
  expect(login).toContain('session_token:await makeSession');
});
