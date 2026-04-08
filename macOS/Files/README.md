# ParaX Pro

Plugin para Adobe After Effects com foco em parallax cinematografico, camera rig, controle de foco, camera shake e workflow rapido para composicoes em profundidade.

## Compatibilidade

- Windows
- macOS
- Adobe After Effects CC 2019 ou superior

## Estrutura Da Pasta

- `Windows/`
  Arquivos do instalador Windows.
- `Mac/`
  Arquivos do instalador Mac.
- raiz desta pasta
  Arquivos principais do plugin usados pelos dois instaladores.

## Conteudo Principal

- `ParaX Pro.jsx`
  Painel principal do plugin.
- `ParaX Pro Installer.jsx`
  Instalador manual do pseudo-effect `PU | Settings`.
- `PU_Settings_v11.xml`
  Arquivo XML principal do pseudo-effect.
- `LEIA-ME.txt`
  Guia rapido em texto simples.
- `ParaX-Pro-100k-Plan.pdf`
  Plano comercial/exportado.

## Windows

Arquivos dentro de `Windows/`:

- `ParaX Pro Setup.iss`
  Projeto do instalador profissional via Inno Setup.
- `ParaX-Pro-Setup-v5.7.exe`
  Instalador Windows pronto para distribuicao.
- `installer-assets/`
  Icone e imagens visuais do instalador.

### Como gerar o instalador Windows

1. Instale o [Inno Setup](https://jrsoftware.org/isinfo.php)
2. Abra `Windows/ParaX Pro Setup.iss`
3. Clique em `Build`
4. O `.exe` sera gerado dentro da pasta `Windows/`

### O instalador Windows faz

- detecta instalacoes do Adobe After Effects
- permite selecionar uma ou mais versoes
- copia `ParaX Pro.jsx` para `ScriptUI Panels`
- instala o pseudo-effect no `PresetEffects.xml`
- cria backup automatico `.bak`

## Mac

Arquivos dentro de `Mac/`:

- `ParaX Pro Mac Installer.command`
  Instalador automatico simples para macOS.
- `mac-pkg/`
  Projeto do instalador profissional `.pkg`.

### Opcao 1: instalador automatico simples

1. Feche o After Effects.
2. Execute `Mac/ParaX Pro Mac Installer.command`
3. Escolha a versao do Adobe After Effects.
4. Autorize com a senha de administrador.
5. Reabra o After Effects e abra `Window > ParaX Pro`

### Opcao 2: instalador profissional .pkg

No Mac, rode:

```bash
cd "ParaX Pro Distribution/Mac/mac-pkg"
chmod +x build-mac-pkg.sh scripts/postinstall
./build-mac-pkg.sh
```

Isso gera:

`Mac/ParaX-Pro-Mac-Installer-v5.7.pkg`

## Antes De Instalar

No After Effects, ative:

`Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network`

Sem essa opcao, o instalador nao conseguira editar o `PresetEffects.xml`.

## Instalacao Manual

Se voce quiser instalar manualmente:

1. Feche o After Effects.
2. Copie `ParaX Pro.jsx` para:

   `Adobe After Effects > Support Files > Scripts > ScriptUI Panels`

3. Rode `ParaX Pro Installer.jsx` uma vez.
4. Reinicie o After Effects.
5. Abra o painel em:

   `Window > ParaX Pro`

## Observacoes

- No Windows, pode ser necessario executar o After Effects como administrador.
- No macOS, o sistema pode pedir permissao extra para alterar arquivos da aplicacao.
- Sempre reinicie o After Effects depois de instalar.
- Os dois instaladores usam os arquivos da raiz desta pasta.

## Suporte

Se o painel abrir, mas o `PU | Settings` nao aparecer corretamente, execute novamente o instalador e reinicie o After Effects.
