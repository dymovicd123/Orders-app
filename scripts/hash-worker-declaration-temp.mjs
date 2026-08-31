import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'
const [file,name]=process.argv.slice(2)
const text=fs.readFileSync(file,'utf8')
const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const names=(statement)=>{
  if ((ts.isFunctionDeclaration(statement)||ts.isClassDeclaration(statement)||ts.isInterfaceDeclaration(statement)||ts.isTypeAliasDeclaration(statement)||ts.isEnumDeclaration(statement))&&statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((d)=>ts.isIdentifier(d.name)?[d.name.text]:[])
  return []
}
const statement=source.statements.find((s)=>names(s).includes(name))
if(!statement) throw new Error(`declaration not found: ${name}`)
const normalized=statement.getText(source).replace(/^export\s+/,'')
process.stdout.write(crypto.createHash('sha256').update(normalized).digest('hex'))
