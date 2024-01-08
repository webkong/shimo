const axios = require('axios');
const Path = require('path');
const download = require('download');
const sleep = require('await-sleep');
const fs = require('fs');
const fse = require('fs-extra');
let config = {};
let fileData = '';
// 读取node命令行参数
const args = process.argv.splice(2);

if (args[1]) {
  fileData = fs.readFileSync(args[1], 'utf8');
} else {
  fileData = fs.readFileSync('config.json', 'utf8');
}

try {
  config = JSON.parse(fileData);
  console.log('config: ', config);
} catch (err) {
  console.error('解析配置文件出错:', err);
}
const headersOptions = {
  Cookie: config.Cookie,
  Referer: 'https://shimo.im/folder/123',
};
const desktopHeadersOptions = {
  Cookie: config.Cookie,
  Referer: 'https://shimo.im/desktop',
};

const localFileLists = getLocalFileList(Path.join(config.Path));
localStr = localFileLists.join('');

getFileList(config.Folder, config.Path);

async function getFileList(folder = '', basePath = '') {
  try {
    const paramsOptions = folder
      ? { collaboratorCount: 'true', folder: folder }
      : { collaboratorCount: 'true' };
    const response = await axios.get('https://shimo.im/lizard-api/files', {
      params: paramsOptions,
      headers: folder ? headersOptions : desktopHeadersOptions,
    });

    for (let i = 0; i < response.data.length; i++) {
      let item = response.data[i];
      let atime = new Date(item.updatedAt).getTime();
      if (atime > config.Lasttime) {
        if (item.is_folder != 1) {
          // console.log(item.name, item.type, item.updatedAt);
          const name = replaceBadChar(item.name);
          const type = getType(item);
          const localFilePath = Path.join(basePath, `${name}.${type}`);
          // 如果type为1，表示不支持导出，跳过
          if (type === 1) {
            continue;
          }
          // 判断本地是否存在
          if (localStr.indexOf(localFilePath) > -1) {
            const stat = fs.statSync(localFilePath);
            // 本地文件更新时间小于石墨文件更新时间
            if (new Date(item.updated_at).getTime() > new Date(stat.mtime).getTime()) {
              console.log('更新:', localFilePath);
            } else {
              console.log('跳过:', localFilePath);
              continue;
            }
          } else {
            console.log('新增:', localFilePath);
          }

          let res = -1;
          for (let j = 0; j <= config.Retry; j++) {
            if (j > 0) {
              console.error('retry ' + j + ' times...');
              await sleep(config.Sleep * 2);
            }
            console.log('开始下载:', localFilePath);
            res = await createExportTask(item, basePath, localFilePath);
            if (res == 0 || res == 1) {
              break;
            }
          }
          if (res != 0) {
            console.error('[Error] Failed to export: ' + item.name);
          }
        } else {
          if (config.Recursive) {
            await getFileList(item.guid, Path.join(basePath, item.name));
          }
        }
      } else {
        console.log('the end');
        process.exit();
      }
    }
  } catch (error) {
    console.error('[Error] ' + error);
  }
}

async function createExportTask(item, basePath = '', localFilePath) {
  try {
    let type = '';
    const name = replaceBadChar(item.name);
    let downloadUrl = '';
    if (
      item.type == 'docx' ||
      item.type == 'doc' ||
      item.type == 'pptx' ||
      item.type == 'ppt' ||
      item.type == 'pdf'
    ) {
      downloadUrl = 'https://shimo.im/lizard-api/files/' + item.guid + '/download';
    } else {
      type = getType(item);

      const url = 'https://shimo.im/lizard-api/files/' + item.guid + '/export';
      //   https://shimo.im/lizard-api/office-gw/files/export?fileGuid=2wAldGvJNGFbl9AP&type=md

      const response = await axios.get(url, {
        params: {
          type: type,
          file: item.guid,
          returnJson: '1',
          name: name,
          isAsync: '0',
        },
        headers: headersOptions,
      });

      //console.log(name, response.data)
      // console.log(response.data.redirectUrl, Path.join(config.Path, basePath));
      downloadUrl = response.data.redirectUrl;
      if (!downloadUrl) {
        downloadUrl = response.data.data.downloadUrl;
      }
    }
    if (!downloadUrl) {
      console.error('[Error] ' + item.name + ' failed, error: ', response.data);
      return 2;
    }
    const options = {
      headers: headersOptions,
    };
    fse.ensureDirSync(basePath);
    await download(downloadUrl, basePath, options);
    // fs.writeFileSync(`${localFilePath}`, await download(downloadUrl, options));
    await sleep(config.Sleep);
  } catch (error) {
    console.error('[Error] ' + item.name + ' failed, error: ' + error.message);
    await sleep(config.Sleep);
    return 3;
  }
  return 0;
}

function replaceBadChar(fileName) {
  // 正则表达式去掉文件名中的无效字符,如 \ / : * ? " < > |
  return fileName.replace(/[\/:*?"<>| ]/g, '_')
}

function getType(item) {
  let type = '';
  const normalType = ['docx', 'doc', 'pptx', 'ppt', 'pdf'];
  if (normalType.indexOf(item.type) > -1) {
    return item.type;
  }

  if (item.type == 'newdoc' || item.type == 'document' || item.type == 'modoc') {
    type = 'md'; //如果想导出word文档，将type改成 docx
  } else if (
    item.type == 'sheet' ||
    item.type == 'mosheet' ||
    item.type == 'spreadsheet' ||
    item.type == 'table' ||
    item.type == 'xls'
  ) {
    type = 'xlsx';
  } else if (item.type == 'slide' || item.type == 'presentation') {
    type = 'pptx';
  } else if (item.type == 'mindmap') {
    type = 'xmind';
  } else {
    console.error('[Error] ' + item.name + ' has unsupported type: ' + item.type);
    return 1;
  }
  return type;
}

// 获取本地文件列表
function getLocalFileList(dirPath) {
  try {
    let filesPath = [];
    const getFile = (dir) => {
      fse.ensureDirSync(dir);
      const files = fs.readdirSync(dir);
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        // 过滤隐藏文件
        if (/^\./.test(file)) {
          continue;
        }
        //拼接获取路径
        let subPath = Path.join(dir, file);
        let stat = fs.statSync(subPath);
        if (stat.isFile()) {
          filesPath.push(subPath);
        } else {
          getFile(subPath);
        }
      }
    };
    getFile(dirPath);
    return filesPath;
  } catch (err) {
    console.log(err);
  }
}
