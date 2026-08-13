from pathlib import Path

schema_path = Path('/home/ubuntu/cqim/prisma/schema.prisma')
text = schema_path.read_text()

text = text.replace('provider = "sqlite"', 'provider = "mongodb"')
text = text.replace('key       String   @id\n', 'key       String   @id @map("_id")\n')

updated_lines = []
for line in text.splitlines():
    stripped = line.strip()
    if stripped.startswith('id') and '@id' in line and '@map("_id")' not in line:
        line = line + ' @map("_id")'
    updated_lines.append(line)

schema_path.write_text('\n'.join(updated_lines) + '\n')
print('updated', schema_path)
