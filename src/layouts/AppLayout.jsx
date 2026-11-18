import React from "react";
import { Outlet } from "react-router-dom";
import EmailVerificationNotice from "../components/EmailVerificationNotice";

export default function AppLayout() {
  return <><EmailVerificationNotice /><Outlet /></>;
}
