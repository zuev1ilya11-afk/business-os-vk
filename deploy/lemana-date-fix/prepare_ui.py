"""Reconstruct unchanged RU browser assets for synthetic offline API fixtures."""
import os,subprocess,tempfile,zipfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent
target=Path(tempfile.mkdtemp(prefix='bos-lemana-dates-ui-'))
for name in subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0'):
 if not name:continue
 source=ROOT/name
 if not source.is_file():continue
 out=target/name;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(source.read_bytes())
base=Path(os.environ.get('BOS_LEMANA_BASE_PACKAGE',HERE/'bos297.pyz'))
with zipfile.ZipFile(base) as z:
 for name in z.namelist():
  if name.startswith(('payload/','optional/')):
   out=target/name.split('/',1)[1];out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(z.read(name))
(HERE/'.ui-root').write_text(str(target))
print('Synthetic UI fixture prepared; no real API calls permitted')
