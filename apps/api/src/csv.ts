import { Readable, Transform } from 'node:stream';
import { stringify } from 'csv-stringify';
import type { FastifyReply } from 'fastify';

export type CsvRow = Record<string, string | number | boolean | null | undefined>;

export function sendCsv(
  reply: FastifyReply,
  filename: string,
  columns: string[],
  rows: AsyncIterable<CsvRow> | Iterable<CsvRow>,
): FastifyReply {
  const stringifier = stringify({
    header: true,
    columns,
    record_delimiter: '\r\n',
    quoted_match: /[",\r\n]/,
  });

  let bomWritten = false;
  const bom = new Transform({
    transform(chunk, _encoding, callback) {
      if (!bomWritten) {
        bomWritten = true;
        this.push(Buffer.from([0xef, 0xbb, 0xbf]));
      }
      this.push(chunk);
      callback();
    },
  });

  const source = Readable.from(rows as AsyncIterable<CsvRow>);
  source.on('error', (error) => stringifier.destroy(error));
  stringifier.on('error', (error) => bom.destroy(error));
  source.pipe(stringifier).pipe(bom);

  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="${filename}"`)
    .header('Cache-Control', 'no-store')
    .send(bom);
}

export function csvBoolean(value: boolean): string {
  return value ? 'TRUE' : 'FALSE';
}
