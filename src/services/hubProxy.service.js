const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { vcomApiBaseUrl } = require('../config/env');

/**
 * Reenvía un post al backend Laravel con los archivos (ya comprimidos).
 *
 * @param {{
 *   titlePost: string,
 *   content?: string,
 *   tagId?: string,
 *   mediaFiles: Array<{finalPath:string, filename:string, mimetype:string}>,
 *   authHeader: string,
 * }} params
 */
async function forwardHubPost({ titlePost, content, tagId, mediaFiles, authHeader }) {
  console.info('[HubProxy→Laravel] authHeader (30):', authHeader?.substring(0, 30));
  console.info('[HubProxy→Laravel] mediaFiles:', mediaFiles.map(f => f.filename));
  const form = new FormData();

  form.append('title_post', titlePost);
  if (content) form.append('content', content);
  if (tagId)   form.append('tag_id', tagId);

  for (const file of mediaFiles) {
    form.append('media[]', fs.createReadStream(file.finalPath), {
      filename: file.filename,
      contentType: file.mimetype,
    });
  }

  const response = await axios.post(
    `${vcomApiBaseUrl}/api/v1/hub/posts`,
    form,
    {
      headers: {
        ...form.getHeaders(),
        Authorization: authHeader,
        Accept: 'application/json',
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 600_000, // 10 min
    },
  );

  return response.data;
}

module.exports = { forwardHubPost };
