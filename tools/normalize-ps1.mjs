// normalize-ps1.mjs —— 把 .ps1 规范成 Windows PowerShell 5.1 能可靠解析的形态。
//
// 为什么需要：本机 Windows 11 中文版，ANSI 代码页 936 (gb2312)。
//   · 无 BOM 的 UTF-8 脚本里含中文 → PS 5.1 按 GBK 解码 → 多字节字符吞掉换行
//     → 行号错位、报出 "Missing closing '}'" 之类的**假语法错误**（实测丢 11 行）。
//   · 纯 LF 行尾在本机同样不稳。
// 所以凡是要被 powershell.exe 执行的 .ps1，一律 **UTF-8 带 BOM + CRLF**。
//
// 用 Node 写这个规范化器而不是用 PowerShell 写，是为了避开鸡生蛋问题：
// Node 显式读写 UTF-8，不受系统代码页影响。
//
// 用法：node tools/normalize-ps1.mjs <file.ps1> [...]
import fs from 'node:fs';
import path from 'node:path';

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** 把单个文件规范化为 UTF-8(BOM) + CRLF；返回是否发生了变化。 */
export function normalizePs1(file) {
  const abs = path.resolve(file);
  const before = fs.readFileSync(abs);

  let text = before.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);      // 去重 BOM，稍后统一加
  text = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');     // 统一 CRLF

  const after = Buffer.concat([BOM, Buffer.from(text, 'utf8')]);
  if (before.equals(after)) return false;
  fs.writeFileSync(abs, after);
  return true;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('用法: node tools/normalize-ps1.mjs <file.ps1> [...]');
  process.exit(2);
}

let changed = 0;
for (const t of targets) {
  const abs = path.resolve(t);
  const before = fs.readFileSync(abs);
  const did = normalizePs1(abs);
  if (!did) {
    console.log('unchanged   ' + t);
    continue;
  }
  const after = fs.readFileSync(abs);
  changed += 1;
  console.log('normalized  ' + t + '   ' + before.length + ' -> ' + after.length + ' bytes  (BOM + CRLF)');
}
console.log('done: ' + changed + ' of ' + targets.length + ' changed');
