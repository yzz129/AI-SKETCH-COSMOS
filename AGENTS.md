# Codex 项目规则

本项目包含大量中文 Markdown、中文注释和中文 UI 文案。

所有文本文件必须使用 UTF-8 编码。读取和写入中文文件时，不要依赖 Windows 默认编码，不要使用未指定编码的 PowerShell / cmd 读取方式。

## 读取中文文件

读取 Markdown、TS、TSX、JSON、CSS 等包含中文的文件时，必须使用 Python 显式指定 UTF-8：

```powershell
python -c "from pathlib import Path; print(Path('README.md').read_text(encoding='utf-8-sig'))"
```

如果文件可能包含 BOM，使用：

```powershell
python -c "from pathlib import Path; print(Path('README.md').read_text(encoding='utf-8-sig'))"
```

不要使用：

```powershell
type README.md
cat README.md
Get-Content README.md
```

除非显式加：

```powershell
Get-Content -Encoding UTF8 README.md
```

## 写入中文文件

写入中文内容时必须使用 Python 显式指定 UTF-8：

```powershell
python -c "from pathlib import Path; Path('README.md').write_text(content, encoding='utf-8')"
```

不要用 Windows 默认编码写入中文文件。

## 修改中文内容

修改中文 Markdown 或 TSX 文案前，必须先用 Python UTF-8 读取确认原文，不要根据终端乱码内容猜测。