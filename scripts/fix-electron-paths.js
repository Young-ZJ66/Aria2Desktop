const fs = require('fs');
const path = require('path');

/**
 * 修复 Electron 构建后的导入路径
 */
function fixElectronPaths() {
  const mainJsPath = path.join(__dirname, '../dist/electron/main.js');
  
  if (!fs.existsSync(mainJsPath)) {
    console.log('main.js not found, skipping path fix');
    return;
  }
  
  let content = fs.readFileSync(mainJsPath, 'utf8');
  
  // 修复相对路径导入
  content = content.replace(
    /require\("\.\.\/src\//g, 
    'require("./src/'
  );
  
  fs.writeFileSync(mainJsPath, content, 'utf8');
  console.log('✅ Fixed Electron import paths in main.js');
}

fixElectronPaths();
