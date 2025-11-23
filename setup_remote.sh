#!/bin/bash
# Script to set up remote git repository and push

echo "=========================================="
echo "Git Remote Setup for Seats.aero RTW Planner"
echo "=========================================="
echo ""

# Check if remote already exists
if git remote -v | grep -q origin; then
    echo "Remote 'origin' already exists:"
    git remote -v
    echo ""
    read -p "Do you want to update it? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Exiting. Remote unchanged."
        exit 0
    fi
fi

echo "Choose your git hosting service:"
echo "1) GitHub"
echo "2) GitLab"
echo "3) Bitbucket"
echo "4) Custom URL"
echo ""
read -p "Enter choice (1-4): " choice

case $choice in
    1)
        read -p "Enter your GitHub username: " username
        read -p "Enter repository name (default: seats-aero-rtw): " repo_name
        repo_name=${repo_name:-seats-aero-rtw}
        remote_url="https://github.com/${username}/${repo_name}.git"
        echo ""
        echo "📝 Create the repository on GitHub first:"
        echo "   1. Go to https://github.com/new"
        echo "   2. Repository name: ${repo_name}"
        echo "   3. Choose public or private"
        echo "   4. DO NOT initialize with README (we already have one)"
        echo ""
        ;;
    2)
        read -p "Enter your GitLab username: " username
        read -p "Enter repository name (default: seats-aero-rtw): " repo_name
        repo_name=${repo_name:-seats-aero-rtw}
        remote_url="https://gitlab.com/${username}/${repo_name}.git"
        echo ""
        echo "📝 Create the repository on GitLab first:"
        echo "   1. Go to https://gitlab.com/projects/new"
        echo "   2. Repository name: ${repo_name}"
        echo "   3. Choose visibility"
        echo ""
        ;;
    3)
        read -p "Enter your Bitbucket username: " username
        read -p "Enter repository name (default: seats-aero-rtw): " repo_name
        repo_name=${repo_name:-seats-aero-rtw}
        remote_url="https://bitbucket.org/${username}/${repo_name}.git"
        echo ""
        echo "📝 Create the repository on Bitbucket first:"
        echo "   1. Go to https://bitbucket.org/repo/create"
        echo "   2. Repository name: ${repo_name}"
        echo ""
        ;;
    4)
        read -p "Enter the full repository URL: " remote_url
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

read -p "Press Enter after you've created the repository on the hosting service..."
echo ""

# Set up remote
if git remote -v | grep -q origin; then
    git remote set-url origin "$remote_url"
    echo "✓ Updated remote 'origin' to: $remote_url"
else
    git remote add origin "$remote_url"
    echo "✓ Added remote 'origin': $remote_url"
fi

# Push to remote
echo ""
echo "Pushing to remote..."
git branch -M main
git push -u origin main

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Successfully pushed to remote!"
    echo ""
    echo "Your repository is now available at:"
    echo "$remote_url"
else
    echo ""
    echo "❌ Push failed. Common issues:"
    echo "   - Repository doesn't exist yet on the hosting service"
    echo "   - Authentication required (you may need to set up SSH keys or use a personal access token)"
    echo "   - Check the remote URL is correct"
fi

