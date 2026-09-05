-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE INDEX "AvatarAgent_organizationId_idx" ON "AvatarAgent"("organizationId");

-- CreateIndex
CREATE INDEX "Avatar_organizationId_idx" ON "Avatar"("organizationId");
