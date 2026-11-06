# 私有考核設定

一般標註不需要題庫。考核功能需要 Python 3.9+；Node.js 入口偵測到題庫時，會啟動同一個 Python 後端。

## 私有目錄

建立 `dist/` 之外的目錄，包含：

```text
exam-private/
  bank.json          場次、時限與題目資料
  access.json        開考密碼的 salt 與 scrypt 雜湊
  media/             題目媒體與可選感測器檔案
  attempts.sqlite3   啟動後自動建立的答卷資料庫
```

以上資料都不應提交 Git。專案的 `.gitignore` 已排除此預設目錄、題庫檔名與資料庫。

## 題庫格式

下列僅為結構說明，請自行準備題目與媒體；儲存庫不附正式題庫。

```json
{
  "edition": "your-exam-edition",
  "minutes": 30,
  "tasks": [
    {
      "id": "your-image-task",
      "type": "image",
      "name": "自行設定的題目名稱",
      "file": "your-image.png",
      "width": 1200,
      "height": 800,
      "labelIds": ["object"],
      "sceneOptions": ["其他"]
    }
  ]
}
```

`file` 指向 `media/` 內的檔名。影片可附 `duration`、`fps`、`goal: "actions"`；文字題使用 `text`；感測器與縮圖檔案可分別使用 `sensor`、`filmstrip`。檔名僅接受英文字母、數字、點、底線與連字號。題目 ID 需以小寫字母起始，總長不超過 51 個字元，後續可用小寫字母、數字與連字號。

## 建立開考密碼

在專案目錄執行，透過終端提示輸入密碼，不將明碼寫入檔案：

```sh
python3 - <<'PY'
from pathlib import Path
from getpass import getpass
import json
import os
import secrets
from exam_service import password_hash

home = Path(os.environ.get('ANNOTATION_EXAM_HOME', 'exam-private'))
home.mkdir(parents=True, exist_ok=True)
salt = secrets.token_hex(16)
password = getpass('Exam password: ')
if not password:
    raise SystemExit('Password must not be empty')
path = home / 'access.json'
path.write_text(json.dumps({'salt': salt, 'hash': password_hash(password, salt)}))
if os.name != 'nt':
    path.chmod(0o600)
PY
```

## 啟動與匯出

將題庫和媒體放妥後啟動：

```sh
ANNOTATION_EXAM_HOME=/absolute/path/to/private-exam python3 serve-python.py
```

瀏覽器開啟 [考核入口](http://localhost:4173/exam.html)。預設 `exam-private/` 可省略環境變數，直接執行 `npm start`；自訂 Python 執行檔可設定 `ANNOTATION_PYTHON`。

考核中姓名、編號、計時與答卷由伺服器處理。倒數會持續，用原瀏覽器可續答；同場編號只開考一次，交卷或逾時後禁止繼續作答。

在伺服器主機執行以下命令匯出答卷：

```sh
ANNOTATION_EXAM_HOME=/absolute/path/to/private-exam python3 exam_service.py export > results.json
```

匯出的答卷包含作答人資訊與標註，請保存在私有位置。
