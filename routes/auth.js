import { Router } from 'express';
import { promisify } from 'node:util';
import User from '../userModel.js';
import { asyncRoute, HttpError, textField } from '../lib/http.js';
import {
  hashPassword,
  isPasswordHash,
  verifyPassword,
} from '../lib/passwords.js';

function passwordField(body, minimum = 1) {
  const password = body?.password;
  if (
    typeof password !== 'string' ||
    password.length < minimum ||
    password.length > 256
  ) {
    throw new HttpError(
      400,
      `Password must contain ${minimum}–256 characters.`,
    );
  }
  return password;
}

export function authRoutes() {
  const router = Router();
  router.get('/register', (req, res) => res.render('pages/register'));
  router.post(
    '/register',
    asyncRoute(async (req, res) => {
      const username = textField(req.body, 'username', 80);
      const password = passwordField(req.body, 8);
      if (await User.exists({ username }))
        throw new HttpError(409, 'That username is already taken.');
      await User.create({ username, password: await hashPassword(password) });
      res.sendStatus(201);
    }),
  );

  router.post(
    '/login',
    asyncRoute(async (req, res) => {
      const username = textField(req.body, 'username', 80);
      const password = passwordField(req.body);
      const user = await User.findOne({ username }).select('+password');
      if (!user || !(await verifyPassword(password, user.password))) {
        throw new HttpError(401, 'Invalid username or password.');
      }
      if (!isPasswordHash(user.password)) {
        await User.updateOne(
          { _id: user._id },
          { $set: { password: await hashPassword(password) } },
        );
      }
      await promisify(req.session.regenerate).call(req.session);
      req.session.loggedin = true;
      req.session.username = user.username;
      req.session.userid = user._id.toString();
      await promisify(req.session.save).call(req.session);
      res.redirect(303, '/home');
    }),
  );

  router.get(
    '/logout',
    asyncRoute(async (req, res) => {
      await promisify(req.session.destroy).call(req.session);
      res.clearCookie('connect.sid');
      res.redirect('/home');
    }),
  );
  return router;
}
