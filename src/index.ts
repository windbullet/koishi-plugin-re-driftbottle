import { Context, Schema, Time, Random, h, $ } from 'koishi'
import { userInfo } from 'os'


export const name = 're-driftbottle'

export interface Bottle {
  id: number;
  uid: string;
  gid: string;
  username: string;
  content: string;
  time: number;
}
export interface Comment {
  id: number;
  cid: number;
  bid: number;
  uid: string;
  gid: string;
  username: string;
  content: string;
  time: number;
}

export interface Config {
  manager: string[];
  allowPic: boolean;
}

declare module 'koishi' {
  interface Tables {
      bottle: Bottle;
      comment: Comment;
  }
}

export const Config: Schema<Config> = Schema.object({
  manager: Schema.array(Schema.string())
    .required()
    .description('管理员QQ，一个项目填一个ID'),
  allowPic: Schema.boolean()
    .description('是否允许发送图片')
    .default(true)
})

export function apply(ctx: Context, config: Config) {
  extendTables(ctx)

  ctx.command("漂流瓶", "漂流瓶")
  
  ctx.command("漂流瓶.扔漂流瓶 [message:text]")
    .usage('扔漂流瓶 <内容>\n也可以引用回复一条消息（去掉@）来直接扔漂流瓶（该方法只能管理员使用或扔自己的消息）')
    .alias("扔漂流瓶")
    .action(async ({ session }, message) => {
      let quote = session.event.message.quote

      if (!message && !quote) return '请输入内容或引用回复一条消息'
      if (quote && !config.manager.includes(session.event.user.id) && quote.user.id !== session.event.user.id) return '你没有权限扔别人的漂流瓶！'

      let uid = quote?.user.id ?? session.event.user.id
      let gid = session.event.channel.id
      let content = quote?.content ?? message;

      message = config.allowPic ? message : message.replace(/<.*?>/g, '')

      if (content.length > 500)
        return '内容过长！'
      if (content.length < 1)
        return '内容过短！'

      await ctx.database.create('bottle', {
        uid: uid, 
        gid: gid, 
        username: session.username,
        content: "“" + content + "”", 
        time: Time.getDateNumber()
      });

      return '你的漂流瓶扔出去了！';
    })

  ctx.command("漂流瓶.捞漂流瓶 [bottleId:posint]")
    .alias("捞漂流瓶")
    .usage('捞漂流瓶 <瓶子编号>\n不填瓶子编号则随机捞一个瓶子')
    .action(async ({ session }, bottleId) => {
      let bottles;
      if (!bottleId) {
        bottles = await ctx.database.get("bottle", {})
        if (!bottles || bottles.length < 1) return "没有瓶子了！"
      } else {
        bottles = await ctx.database.get("bottle", {id: bottleId})
        if (!bottles || bottles.length < 1) return "没有这个瓶子！"
      }

      const bottle = bottles[Random.int(0, bottles.length)];
      const {content, id, uid, username} = bottle;
      const comments = await ctx.database.get('comment', { bid: id });
      const chain = [];
      chain.push({ 
      'text': `你捞到了一只编号为${id}的瓶子！破折号后是漂流瓶主人的昵称！\n发送“评论瓶子 ${id} <内容>”可以在下面评论这只瓶子，发送“评论瓶子 [-r <评论编号>] ${id} <内容>”可以回复评论区的评论`, 
      });
      chain.push({ 
        'id': uid, 
        'text': content, 
        'username': username
      });
      if (comments.length > 0)
        chain.push({ 
          'text': `----评论区，内容前为评论编号，破折号后为评论人昵称----`, 
        });
      for (const comment of comments) {
        const { username: commentName, content: commentContent, uid: commentUid, cid: commentId } = comment;
        chain.push({ 'id': commentId + ".", 'text': commentContent, 'username': commentName });
      }
      let result = ""
      result += chain[0].text + '\n\n' + chain[1].text + `——${chain[1].username}`;
      
      if (comments.length > 0) {
        result += "\n\n" + chain[2].text + "\n"
        for (let i of chain.slice(3)) {
          result += i.id + i.text + "——" + i.username + "\n"
        }
      }

      return result;

    })

    ctx.command('漂流瓶.评论瓶子 <id:posint> [ct:text]', '', {checkArgCount: true})
      .alias('评论瓶子')
      .usage('回复评论时，注意-r与评论编号间有空格，且该参数不能放到最后')
      .option('rid', '-r <rid: integer> 回复评论', { fallback: 0 })
      .example('评论瓶子 [-r <评论编号>] <瓶子编号> <内容>，[]内为可选参数，加上后代表要回复评论而不是评论瓶子')
      .action(async ({ session, options }, id, ct) => {
        const bottle = (await ctx.database.get('bottle', { id: id }))[0];
        if (!bottle) return '你要评论的瓶子不存在！';
        let replyId, comment;
        const rid = parseInt(options.rid) || 0;
        if (rid > 0) {
          replyId = rid;
          comment = (await ctx.database.get('comment', { bid: id, cid: replyId }))[0];
          if (!comment) return '你要回复的评论不存在！';
        }
        const quote = session.event.message.quote
        if (!ct && !quote) return '请输入内容或引用回复一条消息';
        if (quote && !config.manager.includes(session.event.user.id) && quote.user.id !== session.event.user.id) return '你没有权限扔别人的漂流瓶！';
        let uid = quote?.user.id ?? session.event.user.id;
        let gid = session.event.channel.id;
        const { uid: buid, gid: bgid } = bottle;
        ct = config.allowPic ? ct : ct.replace(/<.*?>/g, '');
        if (ct.length > 500) return '内容过长！';
        if (ct.length < 1) return '内容过短！';
        ct = "“" + ct + "”"
        for (const bot of ctx.bots) {
          const guildList = await bot.getGuildIter();
          if (!replyId) {
            if (uid !== buid) {
              for await (let i of guildList) {
                if (i.guildId === bgid) {
                  await bot.sendMessage(bgid, h("at", {id: buid}) + `你的${id}号瓶子有新评论！\n\n${ct}\n\n发送【捞漂流瓶 ${id}】查看详情`)
                  break
                }
              }
            }
          } else {
            const { username: commentUsername, uid: cuid, gid: cgid } = comment;
            ct = `回复 ${replyId}. ${commentUsername}：${ct}`;
            if (cuid !== uid) {
              for await (let i of guildList) {
                if (i.guildId === bgid) {
                  const atUser = h("at", {id: cuid});
                  const message = `${atUser}${id}号瓶子中你的${replyId}号评论有新回复！\n\n${ct}\n\n发送【捞漂流瓶 ${id}】查看详情`;
                  await bot.sendMessage(cgid, message);
                  break;
                }
              }
            }
          }
        }
        let data = await ctx.database.get('comment', { bid: id });
        let cid = data.length === 0 ? 1 : Math.max(...data.map(c => c.cid)) + 1;
        await ctx.database.create('comment', {
          cid: cid,
          bid: id, 
          uid: uid, 
          gid: gid, 
          username: session.username,
          content: ct, 
          time: Time.getDateNumber() 
        });
        return '你的评论已经扔出去了！';
      })

    ctx.command('漂流瓶.删除瓶子 <id:posint>', '', { checkArgCount: true})
      .alias("删除瓶子")
      .example('删除瓶子 <瓶子编号>')
      .action(async ({ session }, id) => {
        const bottle = (await ctx.database.get('bottle', { id: id }))[0];
        if (!bottle)
            return '你要删除的瓶子不存在！';
        if (!config.manager.includes(session.event.user.id) && session.event.user.id !== bottle.uid)
            return '你没有权限删除别人的瓶子！';
        await ctx.database.remove('bottle', { id: id });
        await ctx.database.remove('comment', { bid: id });
        return '瓶子删除了！';
      });

    ctx.command('漂流瓶.删除评论 <bid:posint> <cid:posint>', '', {checkArgCount: true})
      .alias("删除评论")
      .example('删除评论 <瓶子编号> <评论编号>')
      .action(async ({ session }, bid, cid) => {
        const comment = (await ctx.database.get('comment', {bid: bid, cid: cid }))[0];
        if (!comment)
          return '你要删除的评论不存在！';
        if (!config.manager.includes(session.event.user.id) && session.event.user.id !== comment.uid)
          return '你没有权限删除别人的评论！';
        await ctx.database.remove('comment', { bid: bid, cid: cid });
        return '评论删除了！';
      });

    ctx.command('漂流瓶.查看我的瓶子', '')
      .alias('查看我的瓶子')
      .action(async ({ session }) => {
        const bottles = await ctx.database.get('bottle', { uid: session.event.user.id });
        if (!bottles || bottles.length < 1) return '你还没有扔过瓶子！';
        const chain = [];
        chain.push(`你扔出去的瓶子有：`);
        for (const bottle of bottles) {
          const { content, id } = bottle;
          chain.push(`${content}——瓶子编号：${id}`);
        }
        return chain.join('\n');
      })

    ctx.command('漂流瓶.删除过期瓶子 <days:posint>', '删除指定天数前的瓶子，防止数据库过大')
      .alias('删除过期瓶子')
      .example('删除过期瓶子 <天数>')
      .action(async ({ session }, days) => {
        if (!days) return '请输入天数！';
        if (!config.manager.includes(session.userId)) return '你没有权限删除瓶子！';
        const deleteDays = days;
        const bottles = await ctx.database.get('bottle', { time: { $lt: Time.getDateNumber() - deleteDays } });
        if (!bottles || bottles.length < 1) return '没有过期的瓶子！';
        await ctx.database.remove('bottle', { time: { $lt: Time.getDateNumber() - deleteDays } });
        await ctx.database.remove('comment', { time: { $lt: Time.getDateNumber() - deleteDays } });
        await ctx.database.remove('comment', { bid: { $in: bottles.map((bottle) => bottle.id) } });
        return '过期瓶子已经被删除！';
      });
}    
async function extendTables(ctx) {
  await ctx.model.extend('bottle', {
    id: 'unsigned',
    uid: 'string',
    gid: 'string',
    username: 'string',
    content: 'string',
    time: 'unsigned',
  }, {primary: "id", autoInc: true});

  await ctx.model.extend('comment', {
    id: 'unsigned',
    cid: 'unsigned',
    bid: 'unsigned',
    uid: 'string',
    gid: 'string',
    username: 'string',
    content: 'text',
    time: 'unsigned',
  }, {primary: "id", autoInc: true});

  await ctx.model.extend('nameCache', {
    id: 'unsigned'
  })
  
}
